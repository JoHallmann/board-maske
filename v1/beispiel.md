# Beispiel-Board

> Board-Datei für die Board-Maske. Eine Aufgabe ist eine Zeile:
> `- [ ] Titel #projekt @wer allein:ja alle:1w aufwand:u30m ab:JJJJ-MM-TT frist:JJJJ-MM-TT seit:JJJJ-MM-TT ^id`
> Darunter eingerückt: Zeilen `Beschreibung: ...`, danach die Notiz. Abschnitte: Offen, Wartet auf, Zurückgestellt, Erledigt, Verworfen.

Namen: Anna, Ben, KI
Projekte: haushalt, garten, arbeit, verein, sonstiges

### Prompt
Du hilfst Anna und Ben mit dieser Aufgabenliste. Bearbeite nur Aufgaben mit @KI.
Schreibe Deinen Stand als eingerückte Zeile unter die Aufgabe, ganz oben mit Datum.
Brauchst Du eine Entscheidung, schreibe eine Zeile "BRAUCHT ANNA: Frage. Empfehlung: Dein Tipp" und setze @Anna.
Lösche nie etwas. Erledigtes kommt mit [x] unter ## Erledigt.

## Offen
- [ ] Heizkostenabrechnung prüfen #haushalt @Anna aufwand:u30m frist:2026-11-30 seit:2026-11-18 fokus:2026-11-20 ^a1b2c3
  Beschreibung: Abrechnung 2025 kam am 17.11. Verbrauch mit dem Vorjahr vergleichen, Fristen für Einspruch beachten.
  Stand 24.11. 18:10: Vorjahr lag bei 9.840 kWh, neu 10.320 kWh (plus 5 %). Einspruch bis 15.12. möglich.
- [ ] Angebote für neue Waschmaschine vergleichen #haushalt @Anna seit:2026-11-20 ^d4e5f6
  Beschreibung: Frontlader, 8 kg, leise, Energieklasse A. Budget bis 650 €.
  BRAUCHT ANNA: Welche nehmen wir? Empfehlung: Modell B, leiser und 3 Jahre Garantie.
  E1 Modell: a Modell A, 549 €, 52 dB; b Modell B, 619 €, 48 dB, 3 Jahre Garantie; c weiter suchen (b)
  E2 Altgerät mitnehmen lassen für 30 € (ja)
  E3 Lieferung am Samstag (nein, Aufpreis 25 €)
- [ ] Rasen vertikutieren #garten @Ben aufwand:u2h ab:2027-03-15 seit:2026-10-02 ^0a1b2c
  Beschreibung: Gerät beim Nachbarn leihen, danach nachsäen.
- [ ] Müll rausbringen #haushalt @Ben alle:1w aufwand:u5m ab:2026-11-24 seit:2026-09-01 zuletzt:2026-11-17 fokus:2026-11-24 ^f1f2f3
- [ ] Rechnungen für die Steuer sammeln #arbeit @KI allein:ja aufwand:ab2h frist:2027-01-31 seit:2026-11-10 ^c0ffee
  Beschreibung: Alle Belege 2026 aus dem Ordner Rechnungen nach Monat sortieren und Summen je Kategorie bilden.
  Stand 23.11. 21:00: Januar bis August sortiert, Summen in der Tabelle steuer2026.ods. Weiter mit September.
- [ ] Vereinsfeier: Raum anfragen #verein @Ben aufwand:u30m frist:2026-12-05 seit:2026-11-21 ^beef01
  Beschreibung: Für 40 Personen am 19.12. Bürgerhaus oder Pfarrsaal anfragen. Infos: https://example.org/raeume
- [ ] Fahrradreifen flicken #sonstiges @Anna aufwand:u30m seit:2026-11-12 ^abcdef

## Wartet auf
- [ ] Rückruf Hausverwaltung wegen Fenster #haushalt @Hausverwaltung seit:2026-11-14 ^123abc
  Beschreibung: Fenster im Bad schließt nicht mehr dicht. Ticket 4711.
  Stand 21.11.: Nachgefragt, Rückruf versprochen bis 28.11.
- [ ] Paket von der Gärtnerei #garten @Ben frist:2026-11-29 seit:2026-11-19 ^456def

## Zurückgestellt
- [ ] Keller ausmisten #haushalt @Ben aufwand:ab2h seit:2026-08-01 ^789abc
  Beschreibung: Erst nach dem Winter, wenn es draußen trocken ist.

## Erledigt
- [x] Winterreifen montieren #sonstiges @Ben seit:2026-10-10 erledigt:2026-11-02 ^aa11bb
- [x] Steuerberater Termin vereinbaren #arbeit @Anna seit:2026-10-20 erledigt:2026-11-15 ^cc22dd
  Stand 15.11.: Termin am 08.01.2027 um 10 Uhr.

## Verworfen
- [-] Pool aufstellen #garten @Ben seit:2026-06-01 verworfen:2026-09-10 ^ee33ff
  Beschreibung: Zu wenig Platz, bewusst nicht gemacht.
