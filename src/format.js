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
  const UMBRUCH_RE = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;   // alles, was ein Editor als Zeilenende sehen kann
  function zeilen(text) {
    const z = text.split(UMBRUCH_RE);
    if (z.length && z[z.length - 1] === "") z.pop();
    return z;
  }

  function liste(v) {
    return v.split(/[,;]/).map(s => s.trim().replace(/^[#@]/, "").replace(/\.$/, "").trim()).filter(Boolean);
  }

  // Einrichtung im Kopf: "Namen: ...", "Projekte: ..." (auch als "> Projekte: ..." oder fett) und "### Prompt".
  const CFG_RE = /^(>\s*)?(?:[-*]\s+)?\**(Namen|Projekte)\**\s*:\**\s*(.*)$/i;
  const PROMPT_RE = /^###\s+Prompt\b/i;
  // Claude-Anbindung (optional, Standard aus): "Claude: an", "Inbox: ordner", Herzschlag "Claude online: JJJJ-MM-TT HH:MM"
  // (schreibt die eigene Claude-Sitzung) und der Abschnitt "### An Claude" mit den Kurznachrichten.
  const CL_RE = /^(>\s*)?\**(Claude online|Claude|Inbox)\**\s*:\**\s*(.*)$/i;
  const CL_WERT_RE = /^(an|ja|on|yes|aus|nein|off|no)$/i, CL_AN_RE = /^(an|ja|on|yes)$/i;
  const KURZ_KOPF = "### An Claude";
  const KURZ_KOPF_RE = /^###\s+An Claude\s*$/i;
  const ZEIT = "\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}";
  const ZEIT_RE = new RegExp("^" + ZEIT + "$");
  const KURZ_RE = new RegExp("^- (" + ZEIT + ") ([^:]{1,40}): (.*?)(?: karte:\\^?([0-9a-z]{4,12}))? \\^(k[0-9a-f]{6})\\s*$");
  const ANTW_RE = new RegExp("^\\s+Claude (" + ZEIT + "):\\s?(.*)$");
  const GEL_RE = new RegExp("^\\s+gelesen (" + ZEIT + ")\\s*$");
  const KURZ_ID_RE = /^k[0-9a-f]{6}$/;
  function kopfLesen(kopf) {
    const k = {titel: "", namen: [], projekte: [], prompt: "", claude: false, inbox: "", online: "", kurz: []};
    let imPrompt = false, imKurz = false;
    const pl = [], kl = [];
    for (const z of kopf) {
      if (/^#{1,6}\s/.test(z)) {
        imPrompt = PROMPT_RE.test(z);
        imKurz = !imPrompt && KURZ_KOPF_RE.test(z);
        if (imPrompt || imKurz) continue;
        const h1 = /^#\s+(.+)$/.exec(z);
        if (h1 && !k.titel) k.titel = h1[1].trim();
        continue;
      }
      if (imPrompt) { pl.push(z); continue; }
      if (imKurz) { kl.push(z); continue; }
      const m = CFG_RE.exec(z);
      if (m) {
        const v = liste(m[3].replace(/\*\*/g, ""));
        if (m[2].toLowerCase() === "namen") k.namen = v;
        else k.projekte = v.map(p => p.toLowerCase());
        continue;
      }
      const c = CL_RE.exec(z);
      if (c) {
        const art = c[2].toLowerCase(), wert = c[3].replace(/\*\*/g, "").trim();
        if (art === "claude") { if (CL_WERT_RE.test(wert)) k.claude = CL_AN_RE.test(wert); }
        else if (art === "inbox") k.inbox = wert;
        else if (ZEIT_RE.test(wert)) k.online = wert;
      }
    }
    while (pl.length && !pl[0].trim()) pl.shift();
    while (pl.length && !pl[pl.length - 1].trim()) pl.pop();
    k.prompt = pl.join("\n");
    k.kurz = kurzLesen(kl);
    return k;
  }

  // Kurznachrichten: "- JJJJ-MM-TT HH:MM Name: Text [karte:id] ^kxxxxxx", darunter eingerueckt die Antworten
  // "Claude JJJJ-MM-TT HH:MM: ..." (Folgezeilen eingerueckt) und "gelesen JJJJ-MM-TT HH:MM" (setzt die Maske).
  // Ungelesen: eine Antwort steht nach der letzten gelesen-Zeile oder ist juenger als sie.
  function kurzLesen(z) {
    const liste = [];
    let e = null, a = null;
    for (const s of z) {
      let m;
      if ((m = KURZ_RE.exec(s))) {
        e = {id: m[5], t: m[1], wer: m[2].trim(), text: m[3].trim(), karte: m[4] || "", antworten: [], gelesen: "", neu: false};
        liste.push(e); a = null; continue;
      }
      if (!s.trim()) { a = null; continue; }
      if (!e) continue;
      if (!/^\s/.test(s)) { e = null; a = null; continue; }
      if ((m = ANTW_RE.exec(s))) { a = {t: m[1], text: m[2].trim()}; e.antworten.push(a); e.neu = true; continue; }
      if ((m = GEL_RE.exec(s))) { if (m[1] > e.gelesen) e.gelesen = m[1]; e.neu = false; a = null; continue; }
      if (a) a.text += (a.text ? "\n" : "") + s.trim();
    }
    for (const x of liste) {
      const letzte = x.antworten.reduce((m, a) => a.t > m ? a.t : m, "");
      x.ungelesen = !!x.antworten.length && (x.neu || letzte > x.gelesen);
      delete x.neu;
    }
    return liste;
  }
  function kurzBereich(z) {
    const i = z.findIndex(s => KURZ_KOPF_RE.test(s));
    if (i < 0) return null;
    let ende = i + 1;
    while (ende < z.length && !/^#{1,6}\s/.test(z[ende])) ende++;
    return [i, ende];
  }
  // Neue Kurznachricht ans Ende des Abschnitts (legt ihn bei Bedarf an). Gibt den neuen Kopf zurueck.
  function kurzNeu(kopf, n) {
    const z = kopf.slice();
    const text = einzeilig(n.text).replace(/\s+\^k[0-9a-f]{6}$/, "").replace(/(^|\s)karte:(\^?[0-9a-z]{4,12})$/i, "$1karte: $2");
    const wer = einzeilig(n.wer || "").replace(/:/g, "").slice(0, 40).trim() || "Board";
    const zeile = "- " + n.t + " " + wer + ": " + (text || "(leer)") + (n.karte ? " karte:" + n.karte : "") + " ^" + n.id;
    let b = kurzBereich(z);
    if (!b) {
      while (z.length && !z[z.length - 1].trim()) z.pop();
      z.push("", KURZ_KOPF);
      b = [z.length - 1, z.length];
    }
    let pos = b[1];
    while (pos > b[0] + 1 && !z[pos - 1].trim()) pos--;
    z.splice(pos, 0, zeile);
    return z;
  }
  // Als gelesen markieren: "  gelesen ZEIT" ans Ende des Eintrags (alte gelesen-Zeilen weg). null, wenn es ihn nicht gibt.
  function kurzGelesen(kopf, id, zeit) {
    const z = kopf.slice(), b = kurzBereich(z);
    if (!b) return null;
    let i = -1;
    for (let k = b[0] + 1; k < b[1]; k++) { const m = KURZ_RE.exec(z[k]); if (m && m[5] === id) { i = k; break; } }
    if (i < 0) return null;
    let letzte = i;   // letzte eingerueckte Zeile des Eintrags; Leerzeilen beenden ihn nicht (wie in kurzLesen)
    for (let k = i + 1; k < b[1]; k++) { if (!z[k].trim()) continue; if (!/^\s/.test(z[k])) break; letzte = k; }
    for (let k = letzte; k > i; k--) if (GEL_RE.test(z[k])) { z.splice(k, 1); letzte--; }
    z.splice(letzte + 1, 0, "  gelesen " + zeit);
    return z;
  }

  // Schreibt Titel, Namen, Projekte, Claude-Schalter und Prompt in den Kopf; alles andere im Kopf bleibt unberuehrt.
  // Neue Zeilen kommen vor den ersten ###-Abschnitt (z. B. "### An Claude"), damit sie nicht in einen Abschnitt rutschen.
  function kopfSchreiben(kopf, cfg) {
    const vorher = kopfLesen(kopf);
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
    const istCfg = (s) => CFG_RE.test(s) || CL_RE.test(s);
    const setze = (re, wort, wert, neuNoetig, passt) => {
      const i = z.findIndex(s => { const m = re.exec(s); return m && m[2].toLowerCase() === wort.toLowerCase() && (!passt || passt(m[3].replace(/\*\*/g, "").trim())); });
      const zeile = wort + ": " + wert;
      if (i >= 0) { const m = re.exec(z[i]); z[i] = (m[1] ? "> " : "") + zeile; return; }
      if (!neuNoetig) return;
      const abschnitt = z.findIndex(s => /^###\s/.test(s));
      let pos = abschnitt >= 0 ? abschnitt : z.length;
      while (pos > 0 && !z[pos - 1].trim()) pos--;
      if (pos > 0 && !istCfg(z[pos - 1])) { z.splice(pos, 0, ""); pos++; }
      z.splice(pos, 0, zeile);
      if (pos + 1 < z.length && z[pos + 1].trim()) z.splice(pos + 1, 0, "");
    };
    setze(CFG_RE, "Namen", (cfg.namen || []).join(", "), (cfg.namen || []).length > 0);
    setze(CFG_RE, "Projekte", (cfg.projekte || []).join(", "), (cfg.projekte || []).length > 0);
    if (cfg.claude !== undefined && !!cfg.claude !== vorher.claude) setze(CL_RE, "Claude", cfg.claude ? "an" : "aus", true, w => CL_WERT_RE.test(w));
    if (cfg.claude && (einzeilig(cfg.inbox) || "inbox") !== vorher.inbox) setze(CL_RE, "Inbox", einzeilig(cfg.inbox) || "inbox", true);
    while (z.length && !z[z.length - 1].trim()) z.pop();
    const prompt = (cfg.prompt || "").split(UMBRUCH_RE)
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
  function einzeilig(s) { return String(s || "").split(/[\s\x1c-\x1e\x85]+/).filter(Boolean).join(" "); }

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
    normalisieren, naechstes, tageBis, abhaken, verschieben, titelKurz, mehrzeilig, einzeilig, kopfLesen, kopfSchreiben, neueDatei, liste,
    kurzLesen, kurzNeu, kurzGelesen, KURZ_ID_RE};
})();
if (typeof module !== "undefined") module.exports = BM;
