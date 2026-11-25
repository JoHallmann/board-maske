// Board-Maske: Lesen und Schreiben des Board-Formats (Markdown). Reine Funktionen ohne Browser-Zugriff,
// damit sie auch unter Node getestet werden koennen (test/rundlauf.js). Vorbild: aufgaben_server.py (lesen, schreiben,
// normalisieren, abhaken, verschieben). Lizenz MIT.
"use strict";
const BM = (() => {
  const STATUS = ["Offen", "Wartet auf", "Zurückgestellt", "Erledigt", "Verworfen"];
  const KEIN_FOKUS = new Set(["Erledigt", "Verworfen", "Zurückgestellt"]);
  const ZU = (s) => s === "Erledigt" || s === "Verworfen";
  const AUFWAND = ["u5m", "u30m", "u2h", "ab2h"];
  const FOKUS_MAX = 5;
  const TITEL_LANG = 90, TITEL_SCHNITT = 70;
  const BESCHR = "Beschreibung:";
  const ZEILE_RE = /^- \[( |x|X|-)\] (.*)$/;
  const KOPF_RE = /^## (.+?)\s*$/;
  const DATUM_RE = /^(ab|frist|seit|erledigt|verworfen|zuletzt|fokus):(\d{4}-\d{2}-\d{2})$/;
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  const ALLE_RE = /^\d{1,3}[twmj]$/;
  const PROJ_RE = /^#([a-zäöüß][a-z0-9äöüß_-]*)$/i;
  const ID_RE = /^\^[0-9a-z]{4,12}$/;
  const DATUM_FELD = {erledigt: "erledigt_am", verworfen: "verworfen_am"};

  function leer(status) {
    return {id: "", text: "", projekt: "", wer: "", allein: false, ab: "", frist: "", seit: "", erledigt_am: "",
      verworfen_am: "", alle: "", aufwand: "", zuletzt: "", fokus: "", beschreibung: "", notiz: "", status: status || "Offen"};
  }

  // Zeilen wie Pythons str.splitlines(): ein abschliessender Umbruch erzeugt keine leere Zeile.
  function zeilen(text) {
    const z = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
    if (z.length && z[z.length - 1] === "") z.pop();
    return z;
  }

  function liste(v) {
    return v.split(/[,;]/).map(s => s.trim().replace(/^[#@]/, "").replace(/\.$/, "").trim()).filter(Boolean);
  }

  // Einrichtung im Kopf: "Namen: ...", "Projekte: ..." (auch als "> Projekte: ..." oder fett) und "### Prompt".
  const CFG_RE = /^(>\s*)?(?:[-*]\s+)?\**(Namen|Projekte)\**\s*:\**\s*(.*)$/i;
  const PROMPT_RE = /^###\s+Prompt\b/i;
  function kopfLesen(kopf) {
    const k = {titel: "", namen: [], projekte: [], prompt: ""};
    let imPrompt = false;
    const pl = [];
    for (const z of kopf) {
      if (/^#{1,6}\s/.test(z)) {
        if (PROMPT_RE.test(z)) { imPrompt = true; continue; }
        imPrompt = false;
        const h1 = /^#\s+(.+)$/.exec(z);
        if (h1 && !k.titel) k.titel = h1[1].trim();
        continue;
      }
      if (imPrompt) { pl.push(z); continue; }
      const m = CFG_RE.exec(z);
      if (m) {
        const v = liste(m[3].replace(/\*\*/g, ""));
        if (m[2].toLowerCase() === "namen") k.namen = v;
        else k.projekte = v.map(p => p.toLowerCase());
      }
    }
    while (pl.length && !pl[0].trim()) pl.shift();
    while (pl.length && !pl[pl.length - 1].trim()) pl.pop();
    k.prompt = pl.join("\n");
    return k;
  }

  // Schreibt Titel, Namen, Projekte und Prompt in den Kopf; alles andere im Kopf bleibt unberuehrt.
  function kopfSchreiben(kopf, cfg) {
    let z = kopf.slice();
    if (!z.some(s => s.trim())) z = [];
    const titel = (cfg.titel || "").trim() || "Board";
    const h1 = z.findIndex(s => /^#\s+/.test(s));
    if (h1 >= 0) z[h1] = "# " + titel; else z.unshift("# " + titel, "");
    // Prompt-Abschnitt herausnehmen (wird am Ende neu geschrieben)
    const pi = z.findIndex(s => PROMPT_RE.test(s));
    if (pi >= 0) {
      let ende = pi + 1;
      while (ende < z.length && !/^#{1,6}\s/.test(z[ende])) ende++;
      z.splice(pi, ende - pi);
    }
    const setze = (wort, werte) => {
      const i = z.findIndex(s => { const m = CFG_RE.exec(s); return m && m[2].toLowerCase() === wort.toLowerCase(); });
      const zeile = wort + ": " + werte.join(", ");
      if (i >= 0) { const m = CFG_RE.exec(z[i]); z[i] = (m[1] ? "> " : "") + zeile; return; }
      if (!werte.length) return;
      let pos = z.length;
      while (pos > 0 && !z[pos - 1].trim()) pos--;
      if (pos > 0 && !CFG_RE.test(z[pos - 1])) { z.splice(pos, 0, ""); pos++; }
      z.splice(pos, 0, zeile);
    };
    setze("Namen", cfg.namen || []);
    setze("Projekte", cfg.projekte || []);
    while (z.length && !z[z.length - 1].trim()) z.pop();
    const prompt = (cfg.prompt || "").replace(/\r/g, "").split("\n")
      .map(s => /^#/.test(s) || ZEILE_RE.test(s) ? " " + s : s);   // darf keinen Abschnitt und keine Aufgabe erzeugen
    while (prompt.length && !prompt[prompt.length - 1].trim()) prompt.pop();
    if (prompt.some(s => s.trim())) z.push("", "### Prompt", ...prompt);
    return z;
  }

  // Projekt: das letzte #wort aus der Projektliste im Kopf (ohne Liste: das letzte #wort). Wer: das letzte @wort.
  // Alle anderen #- und @-Woerter bleiben Teil des Titels, damit beim Zurueckschreiben nichts verloren geht.
  function eintragAus(rest, status, projekte) {
    const e = leer(status), text = [], toks = rest.split(/\s+/).filter(Boolean);
    const istProj = (t) => { const m = PROJ_RE.exec(t); return !!m && (!projekte || projekte.has(m[1].toLowerCase())); };
    let pi = -1, wi = -1;
    toks.forEach((t, i) => { if (istProj(t)) pi = i; else if (t[0] === "@" && t.length > 1) wi = i; });
    for (const [i, t] of toks.entries()) {
      let m;
      if (t.toLowerCase() === "allein:ja") e.allein = true;
      else if (ID_RE.test(t)) e.id = t.slice(1);
      else if (i === pi) e.projekt = t.slice(1).toLowerCase();
      else if (i === wi) e.wer = t.slice(1).replace(/_/g, " ");
      else if (t.startsWith("alle:") && ALLE_RE.test(t.slice(5))) e.alle = t.slice(5);
      else if (t.startsWith("aufwand:") && AUFWAND.includes(t.slice(8))) e.aufwand = t.slice(8);
      else if ((m = DATUM_RE.exec(t))) e[DATUM_FELD[m[1]] || m[1]] = m[2];
      else text.push(t);
    }
    e.text = text.join(" ");
    return e;
  }

  // projekteVorgabe nur fuer Tests (Abgleich mit dem Original), sonst gilt die Liste im Kopf.
  function lesen(text, projekteVorgabe) {
    const kopf = [], eintraege = [], frei = {};
    STATUS.forEach(s => { frei[s] = []; });
    let aktuell = null, letzte = null, cfg = null, projekte = null;
    for (const z of zeilen(text)) {
      const m = KOPF_RE.exec(z);
      if (m && STATUS.includes(m[1])) {
        if (!cfg) { cfg = kopfLesen(kopf); projekte = projekteVorgabe ? new Set(projekteVorgabe) : cfg.projekte.length ? new Set(cfg.projekte) : null; }
        aktuell = m[1]; letzte = null; continue;
      }
      if (aktuell === null) { kopf.push(z); continue; }
      const mz = ZEILE_RE.exec(z);
      if (mz) {
        const e = eintragAus(mz[2], aktuell, projekte);
        if ("xX".includes(mz[1]) && aktuell !== "Erledigt") e.status = "Erledigt";
        else if (mz[1] === "-" && aktuell !== "Verworfen") e.status = "Verworfen";
        eintraege.push(e);
        letzte = e;
      } else if (letzte && (z[0] === " " || z[0] === "\t") && z.trim()) {
        let s = z.trim();
        if (s.startsWith(BESCHR)) {
          s = s.slice(BESCHR.length).trim();
          letzte.beschreibung += (letzte.beschreibung ? "\n" : "") + s;
        } else letzte.notiz += (letzte.notiz ? "\n" : "") + s;
      } else if (z.trim()) { frei[aktuell].push(z); letzte = null; }
    }
    return {kopf, eintraege, frei, cfg: cfg || kopfLesen(kopf), crlf: /\r\n/.test(text.slice(0, 4000))};
  }

  function zeileAus(e) {
    const t = [e.text.trim() || "(ohne Text)"];
    if (e.projekt) t.push("#" + e.projekt);
    if (e.wer) t.push("@" + e.wer.trim().replace(/ /g, "_"));
    if (e.allein) t.push("allein:ja");
    if (e.alle) t.push("alle:" + e.alle);
    if (e.aufwand) t.push("aufwand:" + e.aufwand);
    for (const k of ["ab", "frist", "seit", "zuletzt", "fokus"]) if (e[k]) t.push(k + ":" + e[k]);
    if (e.erledigt_am) t.push("erledigt:" + e.erledigt_am);
    if (e.verworfen_am) t.push("verworfen:" + e.verworfen_am);
    t.push("^" + e.id);
    const box = {"Erledigt": "x", "Verworfen": "-"}[e.status] || " ";
    return "- [" + box + "] " + t.join(" ");
  }

  function schreiben(m) {
    const z = m.kopf.slice();
    while (z.length && !z[z.length - 1].trim()) z.pop();
    for (const s of STATUS) {
      z.push("", "## " + s);
      for (const e of m.eintraege) {
        if (e.status !== s) continue;
        z.push(zeileAus(e));
        for (const b of (e.beschreibung || "").split("\n")) if (b.trim()) z.push("  " + BESCHR + " " + b);
        for (const n of (e.notiz || "").split("\n")) if (n.trim()) z.push("  " + (n.trim().startsWith(BESCHR) ? "(Notiz) " + n.trim() : n));
      }
      z.push(...(m.frei[s] || []));
    }
    return z.join(m.crlf ? "\r\n" : "\n") + (m.crlf ? "\r\n" : "\n");
  }

  function neueId(belegt, zufall) {
    for (;;) {
      const b = zufall(3);
      const k = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
      if (!belegt.has(k)) return k;
    }
  }

  // Wie normalisieren() im Server: fehlende oder doppelte IDs, Erledigt-/Verworfen-Datum, Stern weg bei Abgeschlossenem.
  function normalisieren(m, heute, zufall) {
    let geaendert = false;
    const alle = new Set(m.eintraege.filter(e => e.id).map(e => e.id)), gesehen = new Set();
    for (const e of m.eintraege) {
      if (!e.id || gesehen.has(e.id)) {
        e.id = neueId(new Set([...alle, ...gesehen]), zufall);
        geaendert = true;
      }
      gesehen.add(e.id);
      if (e.status === "Erledigt" && !e.erledigt_am) { e.erledigt_am = heute; geaendert = true; }
      if (e.status !== "Erledigt" && e.erledigt_am) { e.erledigt_am = ""; geaendert = true; }
      if (e.status === "Verworfen" && !e.verworfen_am) { e.verworfen_am = heute; geaendert = true; }
      if (e.status !== "Verworfen" && e.verworfen_am) { e.verworfen_am = ""; geaendert = true; }
      if (e.fokus && KEIN_FOKUS.has(e.status)) { e.fokus = ""; geaendert = true; }
    }
    return geaendert;
  }

  // Datum: JJJJ-MM-TT ohne Zeitzonen-Fallen (Rechnung in UTC)
  function isoZuDatum(s) { const [j, m, t] = s.split("-").map(Number); return new Date(Date.UTC(j, m - 1, t)); }
  function datumZuIso(d) { return d.toISOString().slice(0, 10); }
  function naechstes(von, alle) {
    const n = parseInt(alle, 10), einheit = alle.slice(-1), d = isoZuDatum(von);
    if (einheit === "t") return datumZuIso(new Date(d.getTime() + n * 864e5));
    if (einheit === "w") return datumZuIso(new Date(d.getTime() + 7 * n * 864e5));
    const mon = d.getUTCMonth() + (einheit === "m" ? n : 12 * n);
    const jahr = d.getUTCFullYear() + Math.floor(mon / 12), monat = ((mon % 12) + 12) % 12;
    const letzter = new Date(Date.UTC(jahr, monat + 1, 0)).getUTCDate();
    return datumZuIso(new Date(Date.UTC(jahr, monat, Math.min(d.getUTCDate(), letzter))));
  }
  function tageBis(iso, heute) { return Math.round((isoZuDatum(iso) - isoZuDatum(heute)) / 864e5); }

  // Erledigt-Knopf: regelmaessige Aufgabe springt weiter (ab: heute plus Rhythmus, Frist wandert mit), sonst Erledigt.
  function abhaken(e, heute) {
    if (e.alle && !ZU(e.status)) {
      const neuAb = naechstes(heute, e.alle);
      const altAb = e.ab || e.frist;
      if (e.frist && altAb) e.frist = naechstes(neuAb, Math.max(tageBis(e.frist, altAb), 0) + "t");
      e.ab = neuAb;
      e.zuletzt = heute;
      e.fokus = "";
      return neuAb;
    }
    e.status = "Erledigt";
    return "";
  }

  function verschieben(e, um, heute) {
    const basis = e.ab && e.ab > heute ? e.ab : heute;
    e.ab = naechstes(basis, um);
    e.fokus = "";
    return e.ab;
  }

  function titelKurz(t) {
    const kopf = t.length > TITEL_SCHNITT ? t.slice(0, TITEL_SCHNITT + 1).replace(/\s+\S*$/, "") : t;
    return kopf.replace(/[ ,;:(-]+$/, "") + " …";
  }

  // Zeilen normalisieren wie bereinigen() im Server: Leerraum je Zeile zusammenziehen, Leerzeilen weg.
  function mehrzeilig(s) {
    return String(s || "").replace(/\r/g, "").split("\n").map(z => z.split(/\s+/).filter(Boolean).join(" ")).filter(Boolean).join("\n");
  }
  function einzeilig(s) { return String(s || "").split(/\s+/).filter(Boolean).join(" "); }

  function neueDatei(cfg) {
    const kopf = kopfSchreiben([
      "# " + (cfg.titel || "Board"), "",
      "> Board-Datei für die Board-Maske. Eine Aufgabe ist eine Zeile:",
      "> `- [ ] Titel #projekt @wer allein:ja alle:1w aufwand:u30m ab:JJJJ-MM-TT frist:JJJJ-MM-TT seit:JJJJ-MM-TT ^id`",
      "> Darunter eingerückt: Zeilen `Beschreibung: ...`, danach die Notiz. Abschnitte: Offen, Wartet auf, Zurückgestellt, Erledigt, Verworfen.",
    ], cfg);
    const frei = {};
    STATUS.forEach(s => { frei[s] = []; });
    return schreiben({kopf, eintraege: [], frei, crlf: false});
  }

  return {STATUS, KEIN_FOKUS, ZU, AUFWAND, FOKUS_MAX, TITEL_LANG, ISO_RE, ALLE_RE, PROJ_RE, leer, lesen, schreiben, zeileAus,
    normalisieren, naechstes, tageBis, abhaken, verschieben, titelKurz, mehrzeilig, einzeilig, kopfLesen, kopfSchreiben, neueDatei, liste};
})();
if (typeof module !== "undefined") module.exports = BM;
