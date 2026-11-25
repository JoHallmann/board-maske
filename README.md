# Board-Maske

Ein Aufgaben-Board im Browser für Deine eigene Markdown-Datei.
Ohne Konto, ohne Server, ohne Cloud. Die Datei bleibt auf Deinem Gerät, die Seite baut keine einzige Verbindung ins Netz auf.

Die Datei ist normales Markdown: Du kannst sie mit jedem Editor öffnen, in Git ablegen, mit Syncthing abgleichen oder einer KI zum Bearbeiten geben. Die Maske ist nur eine bequemere Ansicht darauf.

Open Source unter MIT-Lizenz. **Es gibt keinen Support.** Benutzung auf eigene Verantwortung, bitte Sicherungen Deiner Datei behalten.

## Benutzen

1. https://board.hallmann.top/v1/ öffnen, oder `v1/index.html` von der eigenen Platte bzw. einem eigenen Webspace.
2. **Eigene Datei öffnen** oder **Neue Datei anlegen**. Beim Anlegen fragt die Einrichtung nach Titel, Namen, Projekten und dem Prompt für eine KI. Das alles steht danach im Kopf der Datei.
3. Wer bist Du? Den eigenen Namen wählen, damit „Meine“ und „Fragen an mich“ stimmen. Das merkt sich nur dieser Browser.

**Beispiel ansehen** zeigt ein Beispiel-Board, das nur im Browser liegt.

### Speichern je nach Browser

| Browser | Wie |
|---|---|
| Edge, Chrome, Opera, Brave (PC) | Die Maske schreibt direkt in die gewählte Datei (File System Access). Ändert ein anderes Programm die Datei, zeigt die Maske das nach wenigen Sekunden. |
| Firefox, Safari, alle Handys | Die Maske arbeitet auf einer Kopie im Browser. **Herunterladen** (oder **Teilen** am Handy) gibt die Datei wieder heraus. Für echtes Arbeiten am Handy siehe unten. |

### Am Handy mit der Datei auf dem PC

`v1/handy.html` erklärt das und enthält einen Prompt zum Kopieren: Eine KI (Claude, ChatGPT o. ä.) richtet damit auf dem PC den kleinen Dienst `board_lokal.py` und ein VPN (Tailscale oder WireGuard) ein. Danach öffnet das Handy das Board über das VPN und schreibt direkt in die Datei auf dem PC. Nichts liegt offen im Internet, kein Port am Router.

Von Hand:

```
python v1/board_lokal.py --datei /pfad/zu/board.md
```

öffnet die Maske unter http://127.0.0.1:8790/. Für das VPN `--host` auf die VPN-Adresse des PCs setzen (Tailscale-Netz 100.64.0.0/10 ist schon erlaubt, ein WireGuard-Netz mit `--erlaube 10.77.0.0/24`).

Der Dienst braucht nur Python 3.9 oder neuer, keine Pakete. Er liefert ausschließlich die Maske und die eine Datei, nimmt nur Anfragen aus erlaubten Netzen mit passendem Host-Kopf an, schreibt atomar und lehnt Schreibversuche ab, wenn die Datei sich inzwischen geändert hat (ETag/If-Match).

## Format der Datei

```
# Titel

Namen: Anna, Ben, KI
Projekte: haushalt, garten, arbeit

### Prompt
Text für eine KI, die diese Datei mitbearbeitet.

## Offen
- [ ] Titel #projekt @wer allein:ja alle:1w aufwand:u30m ab:2026-12-01 frist:2026-12-15 seit:2026-11-25 ^a1b2c3
  Beschreibung: Was genau zu tun ist.
  Weitere eingerückte Zeilen sind die Notiz (Stand, Verlauf, Fragen).

## Wartet auf
## Zurückgestellt
## Erledigt
- [x] … erledigt:2026-11-25 ^…
## Verworfen
- [-] … verworfen:2026-11-25 ^…
```

| Feld | Bedeutung |
|---|---|
| `#projekt` | eines der Projekte aus dem Kopf (das letzte passende Wort zählt, andere `#wörter` bleiben Teil des Titels) |
| `@wer` | zuständig, Leerzeichen als `_` |
| `allein:ja` | eine KI darf das ohne Rückfrage erledigen |
| `alle:3t` / `2w` / `1m` / `1j` | wiederkehrend; Abhaken setzt `ab:` auf das nächste Datum statt zu erledigen |
| `aufwand:` | `u5m`, `u30m`, `u2h`, `ab2h` |
| `ab:` | erst ab diesem Tag fällig, davor blass |
| `frist:` | Frist |
| `fokus:` | Stern, höchstens fünf gleichzeitig |
| `^id` | sechs Hexzeichen, eindeutig; fehlt sie, ergänzt die Maske sie |

**Fragen an Dich:** Eine Notizzeile `BRAUCHT ANNA: Frage. Empfehlung: Tipp` erscheint bei Anna unter „Fragen an mich“, bis darunter eine Antwortzeile `Anna 25.11. 18:30 (Board): …` steht. Eine Entscheidungsliste darunter (`E1 Thema: a Option; b Option (b)` oder `E2 Frage (ja)`) wird zu Knöpfen.

Die Maske lässt alles stehen, was sie nicht versteht: freie Zeilen, fremde Felder, Zeilenenden (LF oder CRLF).

## Datenschutz und Sicherheit

* Die Seite ist eine einzige HTML-Datei mit eingebettetem Skript. Keine Fremd-Skripte, keine Schriften aus dem Netz, keine Statistik.
* Die Content-Security-Policy verbietet jede Netzverbindung (`connect-src 'none'`) und erlaubt nur die eingebetteten Skripte und Stile über ihre SHA-256-Summe. Nur die von `board_lokal.py` ausgelieferte Fassung darf mit genau diesem Dienst sprechen (`connect-src 'self'`).
* Im Browser bleiben nur: der Zugriff auf die gewählte Datei bzw. die Kopie (IndexedDB) sowie Dein Name und eingeklappte Bereiche (localStorage). **Board schließen** im Menü löscht Dateizugriff und Kopie, das Löschen der Websitedaten im Browser entfernt alles.
* `pruefsummen.txt` in jeder Version enthält die SHA-256-Summen der ausgelieferten Dateien.

Wer die Seite selbst ablegt, kann die CSP zusätzlich als HTTP-Kopfzeile senden, siehe `beispiel.htaccess`.

## Versionen

Jede Version liegt in ihrem eigenen Ordner (`v1/`, später `v2/` …) und ändert sich nach der Freigabe nie mehr; Links mit Versionsnummer bleiben also stabil. Eine freigegebene Version trägt die Datei `.freigegeben`, das Bauskript verweigert dann den Neubau.

## Bauen und testen

```
python werkzeuge/build.py v1          # baut v1/ aus src/
python test/rundlauf.py               # Formatlogik: Rundlauf, Einrichtung, CRLF, fremde Wörter
node test/browser.js v1 <bildordner>  # Edge/Chrome headless: Klickwege, Dienst, CSP, Netz, Bildschirmfotos
```

Gebraucht werden Python 3.9+, für die Tests Node 22 und Edge oder Chrome. `test/rundlauf.py --original <server.py> --datei <board.md>` vergleicht die Formatlogik zusätzlich mit einer Python-Fassung (nur auf einer Kopie der Datei).

Quellen: `src/format.js` (Lesen/Schreiben des Formats), `src/board.js` (Oberfläche), `src/board.css`, `src/index.html`, `src/handy.html`, `werkzeuge/board_lokal.py`.

## Lizenz

MIT, siehe `LICENSE`. Copyright (c) 2026 Jonas Hallmann.

## Von mir

Gebaut von Jonas Hallmann. Weitere Projekte:

* [BiteLite](https://bitelite.app/): Ernährungstagebuch ohne Kalorienzählen
* [PocketPodium](https://pocketpodium.app/): Reden üben, Füllwörter und Tempo messen
