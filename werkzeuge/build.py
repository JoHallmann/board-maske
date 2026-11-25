#!/usr/bin/env python3
"""Baut eine Version der Board-Maske: python werkzeuge/build.py v1

Ergebnis im Ordner <version>/: index.html (alles eingebettet), handy.html, beispiel.md, board_lokal.py, LICENSE,
board-maske-<version>.zip (die fuenf Dateien, so entpackt laeuft der Dienst), pruefsummen.txt.
Dazu die Versionsuebersicht index.html im Wurzelordner.
WICHTIG beim Hochladen auf den Webspace: *.py NICHT hochladen. Der Hoster fuehrt .py als Skript aus (liefert 500);
board_lokal.py gibt es dort nur im ZIP, im Netz sonst auf GitHub (raw).
Die Content-Security-Policy erlaubt nur die eingebetteten Skripte und Stile (per SHA-256) und verbietet jede Verbindung.
Eine freigegebene Version (Datei <version>/.freigegeben) wird nie neu gebaut: veroeffentlichte Links bleiben stabil.
"""
import base64
import hashlib
import html
import json
import os
import re
import sys
import tempfile
import zipfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
SRC = WURZEL / "src"


def sha(text):
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode() + "'"


def csp(js, css):
    teile = ["default-src 'none'", "style-src " + sha(css), "img-src data:", "connect-src 'none'",
             "form-action 'none'", "base-uri 'none'", "object-src 'none'"]
    if js:
        teile.insert(1, "script-src " + sha(js))
    return "; ".join(teile)


def atomar(pfad, inhalt):
    pfad.parent.mkdir(parents=True, exist_ok=True)
    daten = inhalt.encode("utf-8") if isinstance(inhalt, str) else inhalt
    fd, tmp = tempfile.mkstemp(prefix="." + pfad.name + ".", dir=str(pfad.parent))
    with os.fdopen(fd, "wb") as f:
        f.write(daten)
    os.replace(tmp, pfad)


def paket(dateien, version):
    """ZIP mit festen Zeitstempeln und fester Reihenfolge, damit die Pruefsumme stabil bleibt."""
    import io
    puffer = io.BytesIO()
    with zipfile.ZipFile(puffer, "w", zipfile.ZIP_DEFLATED) as z:
        for name in sorted(dateien):
            inhalt = dateien[name]
            info = zipfile.ZipInfo("board-maske-%s/%s" % (version, name), (2026, 11, 25, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, inhalt.encode("utf-8") if isinstance(inhalt, str) else inhalt)
    return puffer.getvalue()


def seite(vorlage, css, js, version):
    for verboten, wo in (("</script", js), ("</style", css)):
        if verboten in wo.lower():
            sys.exit("Abbruch: %s im eingebetteten Text" % verboten)
    t = (SRC / vorlage).read_text(encoding="utf-8")
    for platz in ("@@CSP@@", "@@CSS@@", "@@JS@@"):
        if t.count(platz) != 1:
            sys.exit("Abbruch: %s kommt in %s nicht genau einmal vor" % (platz, vorlage))
    t = t.replace("@@VERSION@@", version).replace("@@CSP@@", csp(js, css))
    if not js:
        t = t.replace("<script>@@JS@@</script>\n", "").replace("<script>@@JS@@</script>", "")
    return t.replace("@@CSS@@", css).replace("@@JS@@", js)


def uebersicht():
    versionen = sorted((p.name for p in WURZEL.iterdir() if p.is_dir() and re.fullmatch(r"v\d+", p.name)),
                       key=lambda v: int(v[1:]), reverse=True)
    css = ("body{margin:0;font:16px/1.5 system-ui,'Segoe UI',Roboto,Arial,sans-serif;background:#f6f5f1;color:#1d1d1b}"
           "main{max-width:640px;margin:8vh auto;padding:0 16px}a{color:#1f5fad}h1{font-size:28px;margin:0 0 8px}"
           "li{margin:6px 0}.leise{color:#63625d;font-size:14px}"
           "@media (prefers-color-scheme:dark){body{background:#161615;color:#ecebe6}a{color:#7fb0f0}.leise{color:#a3a29b}}")
    punkte = "\n".join('<li><a href="%s/">Board-Maske %s</a>%s</li>' % (v, v, " (neueste)" if i == 0 else "")
                       for i, v in enumerate(versionen))
    return ("<!doctype html>\n<html lang=\"de\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta http-equiv=\"Content-Security-Policy\" content=\"%s\">\n<meta name=\"referrer\" content=\"no-referrer\">\n"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"color-scheme\" content=\"light dark\">\n"
            "<title>Board-Maske</title>\n<style>%s</style>\n</head>\n<body>\n<main>\n<h1>Board-Maske</h1>\n"
            "<p>Aufgaben-Board im Browser für Deine eigene Markdown-Datei. Ohne Konto, ohne Server, nichts verlässt Dein Gerät.</p>\n"
            "<p>Jede Version bleibt unter ihrer Adresse stehen. Neue Funktionen kommen als neue Version (einzige Ausnahme: v1 bekam am 25.11.2026 die optionale Claude-Anbindung, Standard aus).</p>\n"
            "<ul>\n%s\n</ul>\n<p class=\"leise\">Von Jonas Hallmann. Open Source unter MIT-Lizenz, ohne Support. <a href=\"https://github.com/JoHallmann/board-maske\" rel=\"noreferrer\">Quellcode auf GitHub</a> · <a href=\"https://jonashallmann.de/impressum.html\" rel=\"noreferrer\">Impressum</a></p>\n</main>\n</body>\n</html>\n"
            % (html.escape(csp("", css)), css, punkte))


def main():
    version = sys.argv[1] if len(sys.argv) > 1 else "v1"
    if not re.fullmatch(r"v\d+", version):
        sys.exit("Version wie v1, v2 …")
    ziel = WURZEL / version
    nachtrag = None
    if "--nachtrag" in sys.argv:
        nachtrag = sys.argv[sys.argv.index("--nachtrag") + 1]
    if (ziel / ".freigegeben").exists() and not nachtrag:
        sys.exit("%s ist freigegeben und wird nicht mehr verändert. Neue Version bauen (z. B. v%d), oder mit --nachtrag \"Text\" einen Nachtrag vermerken." % (version, int(version[1:]) + 1))
    css = (SRC / "board.css").read_text(encoding="utf-8")
    beispiel = (SRC / "beispiel.md").read_text(encoding="utf-8")
    js = ((SRC / "format.js").read_text(encoding="utf-8") + "\nconst BEISPIEL = "
          + json.dumps(beispiel, ensure_ascii=False).replace("</", "<\\/") + ";\n"
          + (SRC / "board.js").read_text(encoding="utf-8"))
    dateien = {
        "index.html": seite("index.html", css, js, version),
        "handy.html": seite("handy.html", css, (SRC / "handy.js").read_text(encoding="utf-8"), version),
        "beispiel.md": beispiel,
        "board_lokal.py": (WURZEL / "werkzeuge" / "board_lokal.py").read_text(encoding="utf-8").replace("@@VERSION@@", version),
        "LICENSE": (WURZEL / "LICENSE").read_text(encoding="utf-8"),
    }
    summen = []
    for name, inhalt in dateien.items():
        atomar(ziel / name, inhalt)
        summen.append("%s  %s" % (hashlib.sha256(inhalt.encode("utf-8")).hexdigest(), name))
    zipname = "board-maske-%s.zip" % version
    zipdaten = paket(dateien, version)
    atomar(ziel / zipname, zipdaten)
    summen.append("%s  %s" % (hashlib.sha256(zipdaten).hexdigest(), zipname))
    if nachtrag:
        marke = ziel / ".freigegeben"
        alt = marke.read_text(encoding="utf-8") if marke.exists() else ""
        atomar(marke, alt.rstrip("\n") + "\n" + nachtrag + "\n")
    atomar(ziel / "pruefsummen.txt", "\n".join(summen) + "\n")
    atomar(WURZEL / "index.html", uebersicht())
    groesse = (ziel / "index.html").stat().st_size
    print("gebaut: %s (index.html %d KB)" % (ziel, groesse // 1024))


if __name__ == "__main__":
    main()
