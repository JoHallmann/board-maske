#!/usr/bin/env python3
"""Abgleich der JavaScript-Formatlogik (src/format.js) mit einem Python-Original im Format von Aufgaben.md.

  python test/rundlauf.py [--original PFAD/aufgaben_server.py] [--datei PFAD/board.md]

Prueft:
1. Rundlauf: schreiben(lesen(x)) muss in JS und Python byte-gleich sein (nur wenn --original und --datei gegeben).
   Die Datei wird nur GELESEN; Python schreibt in eine Kopie in einem temporaeren Ordner.
2. Idempotenz: JS schreiben(lesen(x)) zweimal hintereinander ergibt dasselbe (beispiel.md und --datei).
3. Datumslogik naechstes/abhaken/verschieben gegen das Original (nur mit --original).
4. Einrichtung im Kopf: kopfSchreiben/kopfLesen.
Braucht node im Pfad.
"""
import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
FEHLER = []


def js(code, eingabe):
    prog = "const BM = require(%s);\nconst E = JSON.parse(require('fs').readFileSync(0, 'utf8'));\n%s" % (
        json.dumps(str(WURZEL / "src" / "format.js")), code)
    r = subprocess.run(["node", "-e", prog], input=json.dumps(eingabe).encode("utf-8"), capture_output=True)
    if r.returncode:
        sys.exit("node-Fehler:\n" + r.stderr.decode("utf-8", "replace"))
    return json.loads(r.stdout.decode("utf-8"))


def pruefe(name, ok, info=""):
    print(("ok    " if ok else "FEHLT ") + name + (("  " + info) if info and not ok else ""))
    if not ok:
        FEHLER.append(name)


def erste_abweichung(a, b):
    za, zb = a.split("\n"), b.split("\n")
    for i, (x, y) in enumerate(zip(za, zb)):
        if x != y:
            return "Zeile %d:\n  JS: %r\n  PY: %r" % (i + 1, x[:160], y[:160])
    return "Laenge %d gegen %d Zeilen" % (len(za), len(zb))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--original")
    ap.add_argument("--datei")
    a = ap.parse_args()

    beispiel = (WURZEL / "src" / "beispiel.md").read_text(encoding="utf-8")
    texte = {"beispiel.md": beispiel}
    if a.datei:
        texte[Path(a.datei).name] = Path(a.datei).read_text(encoding="utf-8")

    for name, text in texte.items():
        r = js("const m1 = BM.schreiben(BM.lesen(E)); const m2 = BM.schreiben(BM.lesen(m1));"
               "const l = BM.lesen(E); process.stdout.write(JSON.stringify({m1, m2, n: l.eintraege.length, cfg: l.cfg}))", text)
        pruefe("Idempotenz JS " + name + " (%d Aufgaben)" % r["n"], r["m1"] == r["m2"], erste_abweichung(r["m1"], r["m2"]))
        if name == "beispiel.md":
            pruefe("Beispiel unverändert nach Rundlauf", r["m1"] == text, erste_abweichung(r["m1"], text))
            pruefe("Beispiel-Einrichtung gelesen", r["cfg"]["namen"] == ["Anna", "Ben", "KI"] and "garten" in r["cfg"]["projekte"]
                   and r["cfg"]["prompt"].strip() != "", json.dumps(r["cfg"], ensure_ascii=False))

    # Einrichtung schreiben und wieder lesen, Rest des Kopfes bleibt
    r = js("const l = BM.lesen(E); const k = BM.kopfSchreiben(l.kopf, {titel: 'Neu', namen: ['X', 'Y'], projekte: ['a', 'b-c'], prompt: 'Zeile 1\\n## gefaehrlich\\n- [ ] auch'});"
           "l.kopf = k; const t = BM.schreiben(l); const l2 = BM.lesen(t);"
           "process.stdout.write(JSON.stringify({cfg: l2.cfg, n1: l.eintraege.length, n2: l2.eintraege.length, kopf: k}))", beispiel)
    pruefe("Einrichtung: Rundlauf Namen/Projekte/Titel", r["cfg"]["titel"] == "Neu" and r["cfg"]["namen"] == ["X", "Y"] and r["cfg"]["projekte"] == ["a", "b-c"],
           json.dumps(r["cfg"], ensure_ascii=False))
    pruefe("Einrichtung: Prompt erzeugt keine Abschnitte oder Aufgaben", r["n1"] == r["n2"] and "## gefaehrlich" in r["cfg"]["prompt"], json.dumps(r, ensure_ascii=False)[:400])
    pruefe("Einrichtung: übriger Kopf bleibt", any("Formatbeschreibung" in z or z.startswith(">") for z in r["kopf"]), "\n".join(r["kopf"]))

    # Leere Datei -> neue Datei
    r = js("const t = BM.neueDatei({titel: 'Test', namen: ['A'], projekte: ['p'], prompt: 'P'}); const l = BM.lesen(t);"
           "process.stdout.write(JSON.stringify({t, cfg: l.cfg, frei: l.frei}))", "")
    pruefe("Neue Datei hat alle fünf Abschnitte", all(("## " + s) in r["t"] for s in ["Offen", "Wartet auf", "Zurückgestellt", "Erledigt", "Verworfen"]), r["t"])
    pruefe("Neue Datei: Einrichtung lesbar", r["cfg"]["titel"] == "Test" and r["cfg"]["namen"] == ["A"] and r["cfg"]["prompt"] == "P", json.dumps(r["cfg"]))

    # CRLF bleibt CRLF
    r = js("process.stdout.write(JSON.stringify(BM.schreiben(BM.lesen(E))))", beispiel.replace("\n", "\r\n"))
    pruefe("CRLF bleibt erhalten", r == beispiel.replace("\n", "\r\n"), erste_abweichung(r, beispiel.replace("\n", "\r\n")))

    # Mehrere #wörter: nichts geht verloren
    t = "# B\nProjekte: haus\n\n## Offen\n- [ ] Text #foo mit #haus und @a @b ^aaaaaa\n"
    r = js("const l = BM.lesen(E); process.stdout.write(JSON.stringify({e: l.eintraege[0], t: BM.schreiben(l)}))", t)
    pruefe("Fremde #wörter und frühere @namen bleiben im Titel", r["e"]["projekt"] == "haus" and r["e"]["wer"] == "b" and "#foo" in r["e"]["text"] and "@a" in r["e"]["text"],
           json.dumps(r["e"], ensure_ascii=False))

    if not a.original:
        return ende()

    tmp = Path(tempfile.mkdtemp(prefix="bm_rundlauf_"))
    try:
        quelle = Path(a.datei) if a.datei else WURZEL / "src" / "beispiel.md"
        kopie = tmp / "board.md"
        shutil.copyfile(quelle, kopie)
        os.environ["BOARD_DATEI"] = str(kopie)
        os.environ["BOARD_PORT"] = "8799"
        spec = importlib.util.spec_from_file_location("orig", a.original)
        orig = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(orig)
        assert Path(orig.DATEI) == kopie, "Original zeigt nicht auf die Kopie"
        import logging
        for h in logging.getLogger().handlers[:]:      # Testaufrufe nicht ins Protokoll des Originals schreiben
            logging.getLogger().removeHandler(h)
            h.close()
        logging.getLogger().addHandler(logging.NullHandler())

        k, e, f = orig.lesen()
        orig.schreiben(k, e, f)
        py = kopie.read_text(encoding="utf-8")
        r = js("process.stdout.write(JSON.stringify(BM.schreiben(BM.lesen(E.text, E.proj))))",
               {"text": quelle.read_text(encoding="utf-8"), "proj": list(orig.PROJEKTE)})
        pruefe("Rundlauf JS = Python (%s, %d Aufgaben, %d KB)" % (quelle.name, len(e), len(py) // 1024), r == py, erste_abweichung(r, py))

        # Felder einzeln vergleichen
        r = js("process.stdout.write(JSON.stringify(BM.lesen(E.text, E.proj).eintraege))",
               {"text": quelle.read_text(encoding="utf-8"), "proj": list(orig.PROJEKTE)})
        felder = ["id", "text", "projekt", "wer", "allein", "ab", "frist", "seit", "erledigt_am", "verworfen_am", "alle", "aufwand",
                  "zuletzt", "fokus", "beschreibung", "notiz", "status"]
        abw = [(x["id"], fe) for x, y in zip(r, e) for fe in felder if x.get(fe) != y.get(fe)]
        pruefe("Felder JS = Python (%d Aufgaben)" % len(e), len(r) == len(e) and not abw, str(abw[:5]))

        # Datumslogik
        faelle = []
        for von in ["2026-01-31", "2026-02-28", "2028-02-29", "2026-12-31", "2026-11-25", "2027-03-31"]:
            for alle in ["1t", "3t", "1w", "2w", "1m", "3m", "13m", "1j", "4j"]:
                faelle.append((von, alle))
        r = js("process.stdout.write(JSON.stringify(E.map(([v, a]) => BM.naechstes(v, a))))", faelle)
        py = [orig.naechstes(date.fromisoformat(v), al).isoformat() for v, al in faelle]
        pruefe("naechstes() JS = Python (%d Fälle)" % len(faelle), r == py, str([(f, x, y) for f, x, y in zip(faelle, r, py) if x != y][:4]))

        heute = date.today().isoformat()
        aufgaben = [
            {"alle": "1w", "ab": "", "frist": "", "status": "Offen"},
            {"alle": "1m", "ab": "2026-10-01", "frist": "2026-10-10", "status": "Offen"},
            {"alle": "2w", "ab": "", "frist": "2026-12-01", "status": "Wartet auf"},
            {"alle": "1j", "ab": "2026-12-20", "frist": "2026-12-01", "status": "Offen"},
            {"alle": "", "ab": "", "frist": "2026-12-01", "status": "Offen"},
            {"alle": "1w", "ab": "", "frist": "", "status": "Erledigt"},
        ]
        r = js("process.stdout.write(JSON.stringify(E.a.map(x => { const e = Object.assign(BM.leer(x.status), x, {fokus: '2026-01-01'});"
               "const n = BM.abhaken(e, E.h); BM.normalisieren({eintraege: [e]}, E.h, k => require('crypto').randomBytes(k)); return [n, e.ab, e.frist, e.status, e.zuletzt, e.fokus]; })))", {"a": aufgaben, "h": heute})
        py = []
        for x in aufgaben:
            k = "# T\n\n## %s\n- [%s] T alle:%s%s%s fokus:2026-01-01 ^abcabc\n" % (
                x["status"], "x" if x["status"] == "Erledigt" else " ", x["alle"] or "", (" ab:" + x["ab"]) if x["ab"] else "",
                (" frist:" + x["frist"]) if x["frist"] else "")
            k = k.replace(" alle: ", " ")
            kopie.write_text(k, encoding="utf-8")
            n = orig.abhaken({"id": "abcabc"})
            _, ee, _ = orig.lesen()
            y = ee[0]
            py.append([n, y["ab"], y["frist"], y["status"], y["zuletzt"], y["fokus"]])
        pruefe("abhaken() JS = Python (%d Fälle)" % len(aufgaben), r == py, "\nJS %s\nPY %s" % (r, py))

        verschiebe = [("", "1t"), ("", "1w"), ("2030-01-31", "1m"), ("2020-01-01", "1w")]
        r = js("process.stdout.write(JSON.stringify(E.v.map(([ab, um]) => { const e = Object.assign(BM.leer('Offen'), {ab}); return BM.verschieben(e, um, E.h); })))",
               {"v": verschiebe, "h": heute})
        py = []
        for ab, um in verschiebe:
            kopie.write_text("# T\n\n## Offen\n- [ ] T%s ^abcabc\n" % ((" ab:" + ab) if ab else ""), encoding="utf-8")
            py.append(orig.verschieben({"id": "abcabc", "um": um})[0])
        pruefe("verschieben() JS = Python (%d Fälle)" % len(verschiebe), r == py, "\nJS %s\nPY %s" % (r, py))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return ende()


def ende():
    print("\n%s" % ("ALLES OK" if not FEHLER else "%d FEHLER: %s" % (len(FEHLER), ", ".join(FEHLER))))
    return 1 if FEHLER else 0


if __name__ == "__main__":
    sys.exit(main())
