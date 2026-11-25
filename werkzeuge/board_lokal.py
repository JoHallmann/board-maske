#!/usr/bin/env python3
"""Board-Maske, lokaler Dienst fuer den Zugriff vom Handy ueber das eigene VPN.

Zeigt die Board-Maske (index.html aus demselben Ordner) an und liest und schreibt genau EINE Datei:
die Board-Datei, die beim Start angegeben wird. Nur Python-Standardbibliothek, kein Netzwerkzugriff nach aussen.

  python board_lokal.py --datei "C:\\Pfad\\board.md"                       # nur dieser PC: http://127.0.0.1:8790/
  python board_lokal.py --datei board.md --host 100.101.102.103          # Tailscale-Adresse des PCs
  python board_lokal.py --datei board.md --host 10.77.0.1 --erlaube 10.77.0.0/24   # WireGuard
  python board_lokal.py --datei board.md --inbox                         # zusaetzlich Dateien vom Handy in den Ordner inbox

Mit --inbox [ORDNER] (Standard aus) nimmt der Dienst Dateien fuer die Claude-Inbox an (je hoechstens 25 MB) und legt sie
in diesen Ordner (relativ zur Board-Datei, Standard "inbox"). Vorhandene Dateien werden nie ueberschrieben.

Sicherheit:
- Antwortet nur Clients aus 127.0.0.0/8, ::1, Tailscale (100.64.0.0/10, fd7a:115c:a1e0::/48) und --erlaube-Netzen.
- Host-Kopf muss eine IP-Adresse, localhost oder ein *.ts.net-Name sein (Schutz gegen DNS-Rebinding).
- Schreiben nur mit passendem If-Match (sonst 412) und ohne fremden Origin-Kopf; atomar ueber eine Zwischendatei.
- Die ausgelieferte Seite erlaubt Verbindungen nur zu diesem Dienst (connect-src 'self'), sonst nirgendwohin.
- Inbox (nur mit --inbox): Dateiname wird bereinigt, nur direkt in den Inbox-Ordner, nie ueberschreiben, gleiche Pruefungen.

Version @@VERSION@@ · Lizenz MIT · kein Support.
"""
import argparse
import hashlib
import http.server
import ipaddress
import json
from html import escape
import os
import re
import sys
import tempfile
import threading
import unicodedata
from pathlib import Path
from urllib.parse import unquote

ORDNER = Path(__file__).resolve().parent
MAX_GROESSE = 20 * 1024 * 1024
MAX_INBOX = 25 * 1024 * 1024
STANDARD_NETZE = ["127.0.0.0/8", "::1/128", "100.64.0.0/10", "fd7a:115c:a1e0::/48"]
SPERRE = threading.Lock()


def etag(daten):
    return '"' + hashlib.sha256(daten).hexdigest()[:32] + '"'


def seite_fuer_dienst(html, inbox=""):
    """Die Seite ist fuer 'kein Netz' gebaut. Fuer den Dienst darf sie genau mit diesem Dienst sprechen."""
    html = html.replace("connect-src 'none'", "connect-src 'self'", 1)
    meta = '<meta name="board-server" content="1">' + ('\n<meta name="board-inbox" content="%s">' % escape(inbox, quote=True) if inbox else "")
    return html.replace("<head>", "<head>\n" + meta, 1)


def sicherer_name(name):
    """Nur ein Dateiname, kein Pfad: Trenner, Steuerzeichen und Windows-Sonderzeichen raus, keine Punkte vorn/hinten."""
    n = unicodedata.normalize("NFC", name)
    n = re.sub(r'[\\/:*?"<>|\x00-\x1f\x7f-\x9f\u2028\u2029]+', "_", n)[:120].strip(" .")
    if not n or re.fullmatch(r"(?i)(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]|conin\$|conout\$)(\..*)?", n):
        n = "datei_" + n
    return n


def freier_name(ordner, name):
    stamm, punkt, endung = name.rpartition(".")
    if not stamm:
        stamm, punkt, endung = name, "", ""
    for i in range(1, 1000):
        n = name if i == 1 else "%s (%d)%s%s" % (stamm, i, punkt, endung)
        if not (ordner / n).exists():
            return n
    raise OSError(17, "zu viele gleichnamige Dateien")


def atomar_schreiben(ziel, daten):
    fd, tmp = tempfile.mkstemp(prefix="." + ziel.name + ".", suffix=".tmp", dir=str(ziel.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(daten)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, ziel)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


class Dienst(http.server.BaseHTTPRequestHandler):
    server_version = "BoardLokal/1"
    sys_version = ""
    protocol_version = "HTTP/1.1"
    datei = None
    inbox = None
    inbox_name = ""
    netze = []
    namen = set()

    def log_message(self, fmt, *args):     # nur Methode, Pfad und Status, nie Inhalte
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def erlaubt(self):
        try:
            ip = ipaddress.ip_address(self.client_address[0].split("%")[0])
            if ip.version == 6 and ip.ipv4_mapped:
                ip = ip.ipv4_mapped
        except ValueError:
            return False
        if not any(ip in n for n in self.netze if n.version == ip.version):
            return False
        host = (self.headers.get("Host") or "").strip().lower()
        m = re.match(r"^\[([0-9a-f:.]+)\](?::\d+)?$|^([^:]+)(?::\d+)?$", host)
        if not m:
            return False
        name = m.group(1) or m.group(2) or ""
        try:
            ipaddress.ip_address(name)
            return True
        except ValueError:
            return name == "localhost" or name.endswith(".ts.net") or name in self.namen

    def senden(self, status, daten=b"", typ="text/plain; charset=utf-8", kopf=None):
        self.send_response(status)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(daten)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        for k, v in (kopf or {}).items():
            self.send_header(k, v)
        if self.command == "PUT" and status >= 400:     # Koerper evtl. ungelesen: Verbindung nicht wiederverwenden
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        if self.command != "HEAD" and daten:
            self.wfile.write(daten)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self.erlaubt():
            return self.senden(403, b"verboten\n")
        pfad = self.path.split("?", 1)[0]
        if pfad in ("/", "/index.html"):
            html = (ORDNER / "index.html").read_text(encoding="utf-8")
            return self.senden(200, seite_fuer_dienst(html, self.inbox_name if self.inbox is not None else "").encode("utf-8"), "text/html; charset=utf-8")
        if pfad == "/handy.html" and (ORDNER / "handy.html").is_file():
            return self.senden(200, (ORDNER / "handy.html").read_bytes(), "text/html; charset=utf-8")
        if pfad == "/board.md":
            with SPERRE:
                daten = self.datei.read_bytes() if self.datei.exists() else b""
            tag = etag(daten)
            if self.headers.get("If-None-Match") == tag:
                return self.senden(304, kopf={"ETag": tag})
            return self.senden(200, daten, "text/markdown; charset=utf-8", {"ETag": tag})
        return self.senden(404, b"nicht gefunden\n")

    def do_PUT(self):
        if not self.erlaubt():
            return self.senden(403, b"verboten\n")
        pfad = self.path.split("?", 1)[0]
        inbox = pfad.startswith("/inbox/") and self.inbox is not None
        if pfad != "/board.md" and not inbox:
            return self.senden(404, b"nicht gefunden\n")
        herkunft = self.headers.get("Origin")
        if herkunft and herkunft.lower() != "http://" + (self.headers.get("Host") or "").lower():
            return self.senden(403, b"fremde Herkunft\n")
        try:
            laenge = int(self.headers.get("Content-Length") or "-1")
        except ValueError:
            laenge = -1
        if inbox:
            return self.inbox_ablegen(pfad, laenge)
        if laenge < 0 or laenge > MAX_GROESSE:
            return self.senden(413, b"zu gross oder ohne Laenge\n")
        daten = self.rfile.read(laenge)
        try:
            daten.decode("utf-8")
        except UnicodeDecodeError:
            return self.senden(400, b"kein UTF-8\n")
        with SPERRE:
            alt = self.datei.read_bytes() if self.datei.exists() else b""
            erwartet = self.headers.get("If-Match")
            if not erwartet or (erwartet != "*" and erwartet != etag(alt)):
                return self.senden(412, b"Datei wurde inzwischen geaendert\n", kopf={"ETag": etag(alt)})
            try:
                atomar_schreiben(self.datei, daten)
            except OSError as e:
                return self.senden(503, ("Schreiben fehlgeschlagen: %s\n" % e.strerror).encode("utf-8"))
        return self.senden(204, kopf={"ETag": etag(daten)})

    def inbox_ablegen(self, pfad, laenge):
        if laenge < 0 or laenge > MAX_INBOX:
            return self.senden(413, b"zu gross oder ohne Laenge\n")
        roh = unquote(pfad[len("/inbox/"):], errors="replace") if "/" not in pfad[len("/inbox/"):] else ""
        name = sicherer_name(roh) if roh else ""
        if not name:
            return self.senden(400, b"Dateiname fehlt\n")
        daten = self.rfile.read(laenge)
        if len(daten) != laenge:
            return self.senden(400, b"unvollstaendig\n")
        with SPERRE:
            try:
                self.inbox.mkdir(parents=True, exist_ok=True)
                name = freier_name(self.inbox, name)
                atomar_schreiben(self.inbox / name, daten)
            except OSError as e:
                return self.senden(503, ("Ablegen fehlgeschlagen: %s\n" % (e.strerror or e)).encode("utf-8"))
        return self.senden(201, json.dumps({"name": name}).encode("utf-8"), "application/json")


def main():
    ap = argparse.ArgumentParser(description="Board-Maske lokal bereitstellen (eine Datei, nur eigenes Netz).")
    ap.add_argument("--datei", required=True, help="Pfad zur Board-Datei (Markdown)")
    ap.add_argument("--host", default="127.0.0.1", help="Adresse, auf der gelauscht wird (Standard 127.0.0.1)")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--erlaube", action="append", default=[], metavar="NETZ", help="weiteres erlaubtes Netz, z. B. 10.77.0.0/24")
    ap.add_argument("--name", action="append", default=[], help="weiterer erlaubter Hostname, z. B. pc.heimnetz")
    ap.add_argument("--inbox", nargs="?", const="inbox", default=None, metavar="ORDNER",
                    help="Dateien fuer die Claude-Inbox annehmen (Standard aus; Ordner relativ zur Board-Datei, Standard inbox)")
    a = ap.parse_args()
    datei = Path(a.datei).expanduser().resolve()
    if not datei.parent.is_dir():
        sys.exit("Ordner fehlt: %s" % datei.parent)
    if not (ORDNER / "index.html").is_file():
        sys.exit("index.html fehlt neben board_lokal.py")
    if a.host in ("0.0.0.0", "::"):
        print("Hinweis: lauscht auf allen Netzen; Anfragen von ausserhalb der erlaubten Netze bekommen 403.")
    Dienst.datei = datei
    if a.inbox is not None:
        Dienst.inbox = (datei.parent / a.inbox).resolve()
        Dienst.inbox_name = a.inbox.replace("\\", "/").strip("/") or "inbox"
        print("Inbox: %s" % Dienst.inbox)
    Dienst.netze = [ipaddress.ip_network(n, strict=False) for n in STANDARD_NETZE + a.erlaube]
    Dienst.namen = {n.lower() for n in a.name}
    klasse = http.server.ThreadingHTTPServer
    if ":" in a.host:
        class V6(http.server.ThreadingHTTPServer):
            address_family = __import__("socket").AF_INET6
        klasse = V6
    srv = klasse((a.host, a.port), Dienst)
    print("Board-Maske: http://%s:%d/  Datei: %s" % ("[" + a.host + "]" if ":" in a.host else a.host, a.port, datei))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
