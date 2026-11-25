// Board-Maske: Oberflaeche. Braucht format.js (BM) und die Konstante BEISPIEL (vom Bauskript eingesetzt).
// Kein Netzwerk: die Seite liest und schreibt nur die Datei, die Du waehlst. Lizenz MIT.
"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const SERVER = !!document.querySelector('meta[name="board-server"]') && location.protocol.startsWith("http");
  const KANN_DATEI = typeof window.showOpenFilePicker === "function";
  const KI_NAMEN = /^(ki|ai|claude|agent|assistent|assistant|bot|chatgpt|gpt|gemini|copilot)$/i;

  // ------------------------------------------------------------------ Hilfen
  function el(tag, props, ...kinder) {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "value") e.value = v;
      else if (k === "checked") e.checked = !!v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : String(v));
    }
    for (const k of kinder.flat(3)) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : String(k));
    return e;
  }
  const zwei = (n) => String(n).padStart(2, "0");
  function heute() { const d = new Date(); return d.getFullYear() + "-" + zwei(d.getMonth() + 1) + "-" + zwei(d.getDate()); }
  function stempel() { const d = new Date(); return zwei(d.getDate()) + "." + zwei(d.getMonth() + 1) + ". " + zwei(d.getHours()) + ":" + zwei(d.getMinutes()); }
  const zufall = (n) => crypto.getRandomValues(new Uint8Array(n));
  function kurz(iso) {
    if (!iso) return "";
    const [j, m, t] = iso.split("-");
    return t + "." + m + "." + (j !== heute().slice(0, 4) ? j.slice(2) : "");
  }
  const ALLE_TEXT = {"1t": "täglich", "1w": "wöchentlich", "2w": "alle 2 Wochen", "1m": "monatlich", "3m": "vierteljährlich", "1j": "jährlich"};
  function alleText(a) {
    if (ALLE_TEXT[a]) return ALLE_TEXT[a];
    const n = parseInt(a, 10), w = {t: ["Tag", "Tage"], w: ["Woche", "Wochen"], m: ["Monat", "Monate"], j: ["Jahr", "Jahre"]}[a.slice(-1)];
    return "alle " + n + " " + (n === 1 ? w[0] : w[1]);
  }
  const AUFWAND_TEXT = {u5m: "≤ 5 Min", u30m: "≤ 30 Min", u2h: "≤ 2 Std", ab2h: "> 2 Std"};
  const KURZ_STATUS = {"Offen": "Offen", "Wartet auf": "Wartet", "Zurückgestellt": "Zurück", "Erledigt": "Erledigt", "Verworfen": "Verw."};
  const URL_RE = /https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/g;
  function mitLinks(text) {
    const teile = [];
    let pos = 0;
    for (const m of text.matchAll(URL_RE)) {
      teile.push(text.slice(pos, m.index));
      teile.push(el("a", {href: m[0], target: "_blank", rel: "noopener noreferrer", class: "lnk", text: m[0]}));
      pos = m.index + m[0].length;
    }
    teile.push(text.slice(pos));
    return teile;
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  let hinweisZeit = 0;
  function hinweis(text, aktion) {
    const h = $("hinweis");
    h.replaceChildren(text);
    if (aktion) h.append(" ", el("button", {class: "mehr", type: "button", text: aktion.text, onclick: () => { h.hidden = true; aktion.tun(); }}));
    h.hidden = false;
    clearTimeout(hinweisZeit);
    hinweisZeit = setTimeout(() => { h.hidden = true; }, aktion ? 7000 : 3500);
  }
  function fehler(err) {
    console.error(err);
    zustand.fehler = true;
    renderSpeicher();
    let t = err && err.message ? err.message : String(err);
    if (err && err.name === "NotAllowedError") { t = "Kein Schreibrecht mehr für die Datei. Oben auf den Speicherstand tippen und erlauben."; zustand.recht = false; }
    if (err && err.name === "NotFoundError") t = "Die Datei ist nicht mehr da (umbenannt oder verschoben?). Bitte neu öffnen.";
    hinweis("Fehler: " + t);
  }

  // ------------------------------------------------------------------ Speicher im Browser (IndexedDB)
  const DB = {
    db: null, ersatz: new Map(),
    async oeffnen() {
      if (this.db) return this.db;
      this.db = await new Promise((ok, nein) => {
        const r = indexedDB.open("board-maske", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => ok(r.result);
        r.onerror = () => nein(r.error);
      });
      return this.db;
    },
    async tx(modus, fn) {
      try {
        const db = await this.oeffnen();
        return await new Promise((ok, nein) => {
          const t = db.transaction("kv", modus), r = fn(t.objectStore("kv"));
          t.oncomplete = () => ok(r && r.result);
          t.onerror = () => nein(t.error);
          t.onabort = () => nein(t.error);
        });
      } catch (e) { return undefined; }
    },
    async get(k) { const v = await this.tx("readonly", s => s.get(k)); return v === undefined ? this.ersatz.get(k) : v; },
    async set(k, v) { this.ersatz.set(k, v); await this.tx("readwrite", s => s.put(v, k)); },
    async del(k) { this.ersatz.delete(k); await this.tx("readwrite", s => s.delete(k)); },
  };
  const LS = {
    get(k, d) { try { const v = localStorage.getItem("bm." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("bm." + k, JSON.stringify(v)); } catch (e) { /* privat */ } },
  };

  // ------------------------------------------------------------------ Zustand
  const zustand = {
    m: null, text: "", recht: true, fehler: false,
    suche: "", chip: "", projekt: "", aufwand: "", tab: "Offen",
    klapp: LS.get("klapp", {}), mehrErledigt: 40, detailId: "",
  };
  let Q = null;  // Quelle: {art: "handle"|"kopie"|"server", name, handle, lastMod, etag, ungesichert, beispiel}

  // ------------------------------------------------------------------ Quelle lesen und schreiben
  async function rechtSichern(fragen) {
    if (!Q || Q.art !== "handle") return true;
    let r = await Q.handle.queryPermission({mode: "readwrite"});
    if (r !== "granted" && fragen) r = await Q.handle.requestPermission({mode: "readwrite"});
    zustand.recht = r === "granted";
    return zustand.recht;
  }
  async function quelleLesen() {
    if (Q.art === "handle") { const f = await Q.handle.getFile(); Q.lastMod = f.lastModified; return await f.text(); }
    if (Q.art === "kopie") { const k = await DB.get("kopie"); return k ? k.text : ""; }
    const r = await fetch("board.md", {cache: "no-store"});
    if (!r.ok) throw new Error("Der Board-Dienst antwortet mit " + r.status);
    Q.etag = r.headers.get("ETag");
    return await r.text();
  }
  async function quelleSchreiben(text) {
    if (Q.art === "handle") {
      const w = await Q.handle.createWritable();   // schreibt in eine Zwischendatei, ersetzt erst beim Schliessen
      await w.write(text);
      await w.close();
      Q.lastMod = (await Q.handle.getFile()).lastModified;
    } else if (Q.art === "kopie") {
      await DB.set("kopie", {name: Q.name, text, ungesichert: !Q.beispiel, beispiel: !!Q.beispiel});
      Q.ungesichert = !Q.beispiel;
    } else {
      const r = await fetch("board.md", {method: "PUT", cache: "no-store", body: text,
        headers: {"Content-Type": "text/markdown; charset=utf-8", "If-Match": Q.etag || "*"}});
      if (r.status === 412) { const e = new Error("Die Datei wurde gerade woanders geändert."); e.konflikt = true; throw e; }
      if (!r.ok) throw new Error("Speichern fehlgeschlagen (" + r.status + ")");
      Q.etag = r.headers.get("ETag");
    }
    zustand.fehler = false;
  }

  function setzeModell(m, text) {
    zustand.m = m;
    zustand.text = text;
    render();
  }

  // Jede Aenderung: Datei frisch lesen, Aenderung per Kennung anwenden, zurueckschreiben. So geht nichts verloren,
  // was jemand anderes (z. B. Deine KI) inzwischen in die Datei geschrieben hat.
  let kette = Promise.resolve();
  function aendern(fn, okText) {
    const lauf = kette.then(async () => {
      if (!(await rechtSichern(true))) { hinweis("Ohne Schreibrecht kann ich nichts speichern."); renderSpeicher(); return false; }
      for (let versuch = 0; versuch < 3; versuch++) {
        const text = await quelleLesen();
        const m = BM.lesen(text);
        BM.normalisieren(m, heute(), zufall);
        const erg = fn(m);
        if (erg === false) { setzeModell(m, text); return false; }
        BM.normalisieren(m, heute(), zufall);
        const neu = BM.schreiben(m);
        try { if (neu !== text) await quelleSchreiben(neu); }
        catch (err) { if (err.konflikt && versuch < 2) continue; throw err; }
        setzeModell(m, neu);
        if (okText) typeof okText === "function" ? okText(erg) : hinweis(okText);
        return erg;
      }
      return false;
    }).catch(err => { fehler(err); return false; });
    kette = lauf.catch(() => {});
    return lauf;
  }
  function mitEintrag(id, fn, okText) {
    return aendern(m => {
      const e = m.eintraege.find(x => x.id === id);
      if (!e) { hinweis("Die Aufgabe ^" + id + " steht nicht mehr in der Datei."); return false; }
      const r = fn(e, m);
      return r === undefined ? e : r;
    }, okText);
  }

  const ABSCHNITT_RE = /^## (Offen|Wartet auf|Zurückgestellt|Erledigt|Verworfen)\s*$/m;
  async function laden() {
    const text = await quelleLesen();
    if (text.trim() && !ABSCHNITT_RE.test(text)) {
      const ja = await frage("Noch kein Board",
        "In „" + Q.name + "“ stehen noch keine Board-Abschnitte (## Offen, ## Erledigt …). Soll ich sie unten anfügen? Der bisherige Inhalt bleibt oben stehen.",
        [["Ja, als Board nutzen", "ja"], ["Abbrechen", ""]]);
      if (ja !== "ja") { await schliessen(true); return; }
    }
    const m = BM.lesen(text);
    if (!text.trim()) {
      zeigeBoard(m, text);
      einrichtung(true);
      return;
    }
    if (BM.normalisieren(m, heute(), zufall) || !ABSCHNITT_RE.test(text)) {
      const neu = BM.schreiben(m);
      if (await rechtSichern(true)) {
        await quelleSchreiben(neu);
        hinweis("Fehlende Kennungen oder Abschnitte ergänzt und gespeichert.");
        zeigeBoard(m, neu);
        return;
      }
    }
    zeigeBoard(m, text);
  }
  function zeigeBoard(m, text) {
    $("start").hidden = true;
    $("kopf").hidden = false;
    $("spalten").hidden = false;
    zustand.fehler = false;
    setzeModell(m, text);
  }

  // Fremde Aenderungen (z. B. Deine KI schreibt in die Datei) alle 4 Sekunden nachladen
  let pruefeLaeuft = false;
  setInterval(async () => {
    if (!Q || !zustand.m || document.hidden || Q.art === "kopie" || pruefeLaeuft) return;
    pruefeLaeuft = true;
    try {
      if (Q.art === "handle") {
        if ((await Q.handle.queryPermission({mode: "read"})) !== "granted") return;
        const f = await Q.handle.getFile();
        if (f.lastModified === Q.lastMod) return;
        await kette;
        const text = await quelleLesen();
        if (text !== zustand.text) setzeModell(BM.lesen(text), text);
      } else {
        const r = await fetch("board.md", {cache: "no-store", headers: {"If-None-Match": Q.etag || ""}});
        if (r.status !== 200) return;
        await kette;
        const text = await quelleLesen();
        if (text !== zustand.text) setzeModell(BM.lesen(text), text);
      }
    } catch (e) { /* naechster Versuch */ } finally { pruefeLaeuft = false; }
  }, 4000);

  // ------------------------------------------------------------------ Ableitungen
  function cfg() { return zustand.m ? zustand.m.cfg : {titel: "", namen: [], projekte: [], prompt: ""}; }
  function ich() { return LS.get("ich", ""); }
  function projekte() {
    const p = [...cfg().projekte];
    for (const e of zustand.m.eintraege) if (e.projekt && !p.includes(e.projekt)) p.push(e.projekt);
    return p;
  }
  function namen() {
    const n = [...cfg().namen];
    const zahl = {};
    for (const e of zustand.m.eintraege) if (e.wer && !BM.ZU(e.status)) zahl[e.wer] = (zahl[e.wer] || 0) + 1;
    for (const w of Object.keys(zahl).sort((a, b) => zahl[b] - zahl[a])) if (!n.some(x => x.toLowerCase() === w.toLowerCase())) n.push(w);
    return n;
  }
  function farbe(p) {
    const i = cfg().projekte.indexOf(p);
    if (i >= 0) return "pc" + (i % 12);
    let h = 0;
    for (const c of p) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return "pc" + (h % 12);
  }
  const gleich = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

  // Offene Frage an mich: letzte Zeile "BRAUCHT <ich>" in der Notiz, danach noch keine Antwortzeile von mir.
  const ENT_ZEILE = /^\s*(?:[-*]\s+)?([A-Z]{0,2}\d{1,3})[.):]?\s+(\S.*)$/;
  function frageInfo(e) {
    const name = ich();
    if (!name || BM.ZU(e.status) || !e.notiz) return null;
    const z = e.notiz.split("\n");
    const braucht = new RegExp("\\bbraucht\\s+" + escRe(name) + "\\b\\s*:?", "i");
    const antwort = new RegExp("^" + escRe(name) + "\\s+\\d{2}\\.\\d{2}\\.\\s+\\d{2}:\\d{2}\\s+\\(Board\\)", "i");
    let i = -1;
    for (let k = z.length - 1; k >= 0; k--) if (braucht.test(z[k])) { i = k; break; }
    if (i < 0) return null;
    for (let k = i + 1; k < z.length; k++) if (antwort.test(z[k])) return null;
    const nach = z[i].slice(z[i].search(braucht)).replace(braucht, "").trim();
    const ep = nach.search(/Empfehlung\s*:/i);
    const info = {frage: (ep >= 0 ? nach.slice(0, ep) : nach).trim(), empf: ep >= 0 ? nach.slice(ep).replace(/^Empfehlung\s*:\s*/i, "").trim() : "", liste: []};
    for (let k = i + 1; k < z.length; k++) {
      const m = ENT_ZEILE.exec(z[k]);
      if (m) info.liste.push(entPunkt(m[1], m[2]));
    }
    if (info.liste.length < 2) info.liste = [];
    return info;
  }
  function entPunkt(schluessel, rest) {
    let text = rest.trim(), empf = "";
    const k = /\(([^()]*)\)\s*$/.exec(text);
    if (k) { empf = k[1].trim(); text = text.slice(0, k.index).trim(); }
    let optionen = [];
    const teile = text.split(/;\s*/);
    const erst = /^(.*?:)?\s*a\s+(.+)$/.exec(teile[0]);
    if (teile.length >= 2 && erst && /^b\s+/.test(teile[1])) {
      optionen = [["a", erst[2].trim()]];
      for (const t of teile.slice(1)) { const m = /^([a-e])\s+(.+)$/.exec(t.trim()); if (m) optionen.push([m[1], m[2].trim()]); else if (optionen.length) optionen[optionen.length - 1][1] += "; " + t; }
      text = (erst[1] || "").replace(/:$/, "").trim();
    }
    let empfWahl = "";
    const ew = /^([a-e]|ja|nein)\b/i.exec(empf);
    if (ew && (optionen.length ? optionen.some(o => o[0] === ew[1].toLowerCase()) : /^(ja|nein)$/i.test(ew[1]))) empfWahl = ew[1].toLowerCase();
    return {schluessel, text, optionen, empf, empfWahl};
  }

  function passtFilter(e, info) {
    const q = zustand.suche.trim().toLowerCase();
    if (q) {
      const heu = [e.text, e.beschreibung, e.notiz, "#" + e.projekt, "@" + e.wer, "^" + e.id].join(" ").toLowerCase();
      if (!q.split(/\s+/).every(w => heu.includes(w))) return false;
    }
    if (zustand.projekt && e.projekt !== zustand.projekt) return false;
    if (zustand.aufwand && (e.aufwand || "ohne") !== zustand.aufwand) return false;
    const c = zustand.chip;
    if (c === "frage" && !info) return false;
    if (c === "meine" && !gleich(e.wer, ich())) return false;
    if (c === "fokus" && !e.fokus) return false;
    if (c === "frist" && !(e.frist && BM.tageBis(e.frist, heute()) <= 7)) return false;
    if (c.startsWith("wer:") && !gleich(e.wer, c.slice(4))) return false;
    return true;
  }

  // ------------------------------------------------------------------ Darstellung
  function render() {
    if (!zustand.m) return;
    const c = cfg();
    $("titel").textContent = c.titel || (Q && Q.name) || "Board";
    document.title = (c.titel || "Board") + " · Board-Maske";
    renderSpeicher();
    renderLeisten();
    renderSpalten();
  }

  function renderSpeicher() {
    const b = $("speicherBtn");
    if (!Q) return;
    let cls = "sbtn ok", t = Q.name || "Board";
    if (zustand.fehler) { cls = "sbtn fehler"; t = "Fehler beim Speichern"; }
    else if (Q.art === "handle" && !zustand.recht) { cls = "sbtn warn"; t = "Zugriff erlauben"; }
    else if (Q.art === "kopie" && Q.beispiel) { cls = "sbtn warn"; t = "Beispiel, nur im Browser"; }
    else if (Q.art === "kopie" && Q.ungesichert) { cls = "sbtn warn"; t = "Nicht gesichert: herunterladen"; }
    else if (Q.art === "kopie") t = "Kopie im Browser";
    else if (Q.art === "server") t = "Board über Deinen PC";
    b.className = cls;
    b.textContent = t;
    b.title = Q.art === "handle" ? "Gespeichert direkt in " + Q.name : t;
  }

  function chip(text, an, klick, extra) {
    return el("button", {type: "button", class: "chip" + (an ? " an" : "") + (extra ? " " + extra : ""), "aria-pressed": an ? "true" : "false", text, onclick: klick});
  }
  function umschalten(feld, wert) { zustand[feld] = zustand[feld] === wert ? "" : wert; render(); }

  function renderLeisten() {
    const alle = zustand.m.eintraege, aktiv = alle.filter(e => !BM.ZU(e.status) && e.status !== "Zurückgestellt");
    const name = ich(), fragen = aktiv.filter(e => frageInfo(e)).length;
    const chips = [];
    if (name) {
      chips.push(chip("Fragen an mich " + fragen, zustand.chip === "frage", () => umschalten("chip", "frage"), fragen ? "frage" : ""));
      chips.push(chip("Meine " + aktiv.filter(e => gleich(e.wer, name)).length, zustand.chip === "meine", () => umschalten("chip", "meine")));
    } else if (namen().length) {
      chips.push(chip("Wer bist Du?", false, waehleIch, "ich"));
    }
    chips.push(chip("★ Fokus " + aktiv.filter(e => e.fokus).length, zustand.chip === "fokus", () => umschalten("chip", "fokus")));
    chips.push(chip("Frist ≤ 7 Tage " + aktiv.filter(e => e.frist && BM.tageBis(e.frist, heute()) <= 7).length,
      zustand.chip === "frist", () => umschalten("chip", "frist"), "trenn"));
    for (const w of namen().filter(n => !gleich(n, name)).slice(0, 10)) {
      const n = aktiv.filter(e => gleich(e.wer, w)).length;
      if (n) chips.push(chip("@" + w + " " + n, zustand.chip === "wer:" + w, () => umschalten("chip", "wer:" + w)));
    }
    $("chips").replaceChildren(...chips);

    const pch = [];
    for (const p of projekte()) {
      const n = aktiv.filter(e => e.projekt === p).length;
      pch.push(chip("#" + p + " " + n, zustand.projekt === p, () => umschalten("projekt", p), "pchip " + farbe(p)));
    }
    $("pchips").replaceChildren(...pch);
    $("pchips").hidden = !pch.length;

    const afw = [el("span", {class: "aufwand-titel", text: "Aufwand"})];
    for (const a of [...BM.AUFWAND, "ohne"]) {
      const n = aktiv.filter(e => (e.aufwand || "ohne") === a).length;
      afw.push(el("button", {type: "button", class: "afw" + (zustand.aufwand === a ? " an" : ""), "aria-pressed": zustand.aufwand === a ? "true" : "false",
        onclick: () => umschalten("aufwand", a)}, a === "ohne" ? "ohne Angabe" : AUFWAND_TEXT[a], el("b", {text: String(n)})));
    }
    $("aufwand").replaceChildren(...afw);

    const tabs = BM.STATUS.map(s => {
      const n = alle.filter(e => e.status === s && passtFilter(e, frageInfo(e))).length;
      return el("button", {type: "button", role: "tab", class: "tab" + (zustand.tab === s ? " an" : ""), "aria-selected": zustand.tab === s ? "true" : "false",
        onclick: () => { zustand.tab = s; render(); scrollTo(0, 0); }}, KURZ_STATUS[s], el("b", {text: String(n)}));
    });
    $("tabs").replaceChildren(...tabs);
  }

  function sortiert(liste, status) {
    const h = heute();
    if (status === "Erledigt" || status === "Verworfen") {
      const f = status === "Erledigt" ? "erledigt_am" : "verworfen_am";
      return liste.map((e, i) => [e, i]).sort((a, b) => (b[0][f] || "").localeCompare(a[0][f] || "") || a[1] - b[1]).map(x => x[0]);
    }
    if (status !== "Offen") return liste;
    const schluessel = (e) => [e.ab && e.ab > h ? 1 : 0, e.fokus ? 0 : 1, e.frist || "9999"];
    return liste.map((e, i) => [e, i, schluessel(e)]).sort((a, b) => {
      for (let k = 0; k < 3; k++) { if (a[2][k] < b[2][k]) return -1; if (a[2][k] > b[2][k]) return 1; }
      return a[1] - b[1];
    }).map(x => x[0]);
  }

  function renderSpalten() {
    const haupt = $("spalten"), teile = [];
    const name = ich();
    if (!name && namen().length) {
      teile.push(el("div", {class: "banner"}, "Wer bist Du? Dann zeigt die Maske Fragen, die an Dich gehen.",
        namen().slice(0, 8).map(n => el("button", {type: "button", text: n, onclick: () => { LS.set("ich", n); render(); }}))));
    }
    if (Q && Q.beispiel) teile.push(el("div", {class: "banner"}, "Das ist das Beispiel-Board. Änderungen bleiben nur in diesem Browser.",
      el("button", {type: "button", text: "Eigene Datei öffnen", onclick: oeffnen})));
    const spalte = (s, titel, cls) => {
      const alle = zustand.m.eintraege.filter(e => e.status === s);
      const liste = sortiert(alle.filter(e => passtFilter(e, frageInfo(e))), s);
      const grenze = s === "Erledigt" || s === "Verworfen" ? zustand.mehrErledigt : Infinity;
      const karten = liste.slice(0, grenze).map(karte);
      if (!karten.length) karten.push(el("div", {class: "leer", text: alle.length ? "Nichts passt zum Filter." : "Keine Aufgaben."}));
      const sec = el("section", {class: "spalte " + cls + (zustand.tab === s ? "" : " aus")},
        el("h2", {text: titel + " · " + liste.length}), el("div", {class: "liste"}, karten));
      if (liste.length > grenze) sec.append(el("button", {type: "button", class: "mehr", text: "Mehr zeigen (" + (liste.length - grenze) + ")",
        onclick: () => { zustand.mehrErledigt += 100; render(); }}));
      return [sec, liste.length];
    };
    teile.push(spalte("Offen", "Offen", "s-offen")[0]);
    teile.push(spalte("Wartet auf", "Wartet auf", "s-wartet")[0]);
    const rail = el("div", {class: "rail"});
    for (const [s, cls] of [["Zurückgestellt", "s-zurueck"], ["Erledigt", "s-erledigt"], ["Verworfen", "s-verworfen"]]) {
      const [sec, n] = spalte(s, s, cls);
      const offen = !!zustand.klapp[s];
      const k = el("div", {class: "klapp" + (offen ? " offen" : "")},
        el("button", {type: "button", class: "klappkopf", "aria-expanded": offen ? "true" : "false",
          onclick: () => { zustand.klapp[s] = !zustand.klapp[s]; LS.set("klapp", zustand.klapp); render(); }},
        el("span", {class: "pfeil", text: "▶"}), s + " · " + n),
        el("div", {class: "klappinhalt"}, sec));
      rail.append(k);
    }
    teile.push(rail);
    haupt.replaceChildren(...teile);
  }

  function metaTeile(e, info, imDetail) {
    const t = [], h = heute();
    if (e.projekt) t.push(el("span", {class: "proj " + farbe(e.projekt), text: "#" + e.projekt}));
    if (info) t.push(el("span", {class: "tag fragetag", text: "Frage an Dich"}));
    if (e.wer) t.push(el("span", {text: "@" + e.wer}));
    if (e.frist && !BM.ZU(e.status)) {
      const d = BM.tageBis(e.frist, h);
      t.push(el("span", {class: "frist" + (d <= 3 ? " knapp" : ""), text: "Frist " + kurz(e.frist) + (d < 0 ? " (vorbei)" : d === 0 ? " (heute)" : "")}));
    }
    if (e.ab && e.ab > h && !BM.ZU(e.status)) t.push(el("span", {text: "ab " + kurz(e.ab)}));
    if (e.alle) t.push(el("span", {class: "tag", text: "↻ " + alleText(e.alle)}));
    if (e.aufwand) t.push(el("span", {class: "tag aufw", text: AUFWAND_TEXT[e.aufwand]}));
    if (e.allein) t.push(el("span", {class: "tag allein", text: "allein"}));
    if (e.status === "Erledigt" && e.erledigt_am) t.push(el("span", {text: "erledigt " + kurz(e.erledigt_am)}));
    if (e.status === "Verworfen" && e.verworfen_am) t.push(el("span", {text: "verworfen " + kurz(e.verworfen_am)}));
    if (imDetail) {
      if (e.seit) t.push(el("span", {text: "seit " + kurz(e.seit)}));
      if (e.zuletzt) t.push(el("span", {text: "zuletzt " + kurz(e.zuletzt)}));
      t.push(el("span", {class: "kid", text: "^" + e.id}));
    }
    return t;
  }

  function karte(e) {
    const info = frageInfo(e), zu = BM.ZU(e.status);
    const cls = "karte" + (e.ab && e.ab > heute() && !zu ? " spaeter" : "") + (e.status === "Erledigt" ? " zu" : "") + (e.status === "Verworfen" ? " zu verworfen" : "");
    const k = el("div", {class: cls, tabindex: "0", role: "button", "data-id": e.id, "aria-label": e.text,
      onclick: () => detail(e.id), onkeydown: (ev) => { if (ev.key === "Enter" && ev.target === k) detail(e.id); }});
    const reihe = el("div", {class: "kreihe"});
    if (!zu && e.status !== "Zurückgestellt") {
      reihe.append(el("button", {type: "button", class: "stern" + (e.fokus ? " an" : ""), "aria-label": e.fokus ? "Stern entfernen" : "Stern setzen",
        title: "Fokus", text: e.fokus ? "★" : "☆", onclick: (ev) => { ev.stopPropagation(); sternUm(e.id); }}));
    }
    reihe.append(el("div", {class: "kinhalt"}, el("div", {class: "ktext", text: e.text}), el("div", {class: "meta"}, metaTeile(e, info, false))));
    if (!zu) reihe.append(el("button", {type: "button", class: "haken", "aria-label": "Erledigt", title: "Erledigt", text: "✓",
      onclick: (ev) => { ev.stopPropagation(); haken(e.id); }}));
    k.append(reihe);
    return k;
  }

  // ------------------------------------------------------------------ Aktionen
  function sternUm(id) {
    return mitEintrag(id, (e, m) => {
      if (e.fokus) { e.fokus = ""; return e; }
      if (m.eintraege.filter(x => x.fokus).length >= BM.FOKUS_MAX) { hinweis("Höchstens " + BM.FOKUS_MAX + " Sterne. Erst einen anderen entfernen."); return false; }
      e.fokus = heute();
      return e;
    });
  }
  function haken(id) {
    const vorher = zustand.m.eintraege.find(x => x.id === id);
    const alt = vorher ? {...vorher} : null;
    return mitEintrag(id, e => { e._neuAb = BM.abhaken(e, heute()); return e; }, (e) => {
      const r = alt ? {text: "Rückgängig", tun: () => mitEintrag(id, x => { Object.assign(x, alt); }, "Zurückgenommen")} : null;
      hinweis(e._neuAb ? "Erledigt. Nächstes Mal ab " + kurz(e._neuAb) + "." : "Erledigt.", r);
      ebeneWeg();
    });
  }

  // ------------------------------------------------------------------ Ebenen (Popup) und Menue
  function ebeneZeigen(panel) {
    const eb = $("ebene");
    eb.replaceChildren(panel);
    if (eb.hidden) {
      eb.hidden = false;
      document.body.classList.add("still");
      if (!(history.state && history.state.ebene)) try { history.pushState({ebene: 1}, ""); } catch (e) { /* file:// */ }
    }
    const f = panel.querySelector("[autofocus]") || panel.querySelector(".zu-btn");
    if (f) f.focus({preventScroll: true});
  }
  function ebeneWeg() {
    const eb = $("ebene");
    if (eb.hidden) return;
    eb.hidden = true;
    eb.replaceChildren();
    document.body.classList.remove("still");
    zustand.detailId = "";
    if (eb._fertig) { const f = eb._fertig; eb._fertig = null; f(""); }
  }
  function ebeneZu() {
    if (history.state && history.state.ebene) history.back(); else ebeneWeg();
  }
  window.addEventListener("popstate", () => { ebeneWeg(); menuZu(); });
  $("ebene").addEventListener("click", (ev) => { if (ev.target === $("ebene")) ebeneZu(); });

  function panel(titel, inhalt, schmal) {
    return el("div", {class: "panel" + (schmal ? " schmal" : ""), role: "dialog", "aria-modal": "true", "aria-label": titel},
      el("div", {class: "pkopf"}, el("h3", {text: titel}), el("button", {type: "button", class: "zu-btn", "aria-label": "Schließen", text: "✕", onclick: ebeneZu})),
      inhalt);
  }
  function frage(titel, text, knoepfe) {
    return new Promise(ok => {
      const p = panel(titel, [el("p", {text}), el("div", {class: "knoepfe"}, knoepfe.map(([t, w], i) =>
        el("button", {type: "button", class: i === 0 ? "speichern" : "", text: t, onclick: () => { const eb = $("ebene"); eb._fertig = null; ebeneZu(); ok(w); }})))], true);
      ebeneZeigen(p);
      $("ebene")._fertig = ok;
    });
  }

  function menuZu() { $("menu").hidden = true; $("menuBtn").setAttribute("aria-expanded", "false"); }
  function menuAuf() {
    const m = $("menu"), punkte = [];
    const knopf = (t, f) => el("button", {type: "button", role: "menuitem", text: t, onclick: () => { menuZu(); f(); }});
    const ort = !Q ? "" : Q.art === "handle" ? "Datei: " + Q.name + " (direkt gespeichert)" : Q.art === "server" ? "Datei auf Deinem PC über das eigene Netz"
      : Q.beispiel ? "Beispiel, nur in diesem Browser" : "Kopie von " + Q.name + " in diesem Browser";
    punkte.push(el("div", {class: "mtext", text: ort}));
    if (!SERVER) {
      punkte.push(knopf("Andere Datei öffnen …", oeffnen));
      punkte.push(knopf("Neues Board anlegen …", anlegen));
    }
    punkte.push(knopf("Einrichtung: Namen, Projekte, Prompt …", () => einrichtung(false)));
    punkte.push(knopf("Wer bin ich? (" + (ich() || "nicht gewählt") + ")", waehleIch));
    punkte.push(el("hr"));
    punkte.push(knopf("Herunterladen (Sicherung)", herunterladen));
    if (Q && Q.art === "kopie" && navigator.canShare) punkte.push(knopf("Datei teilen …", teilen));
    punkte.push(knopf("Prompt für Deine KI kopieren", promptZeigen));
    punkte.push(el("a", {href: "handy.html", target: "_blank", rel: "noopener", role: "menuitem", text: "Handy anbinden (VPN) ↗"}));
    if (!SERVER) { punkte.push(el("hr")); punkte.push(knopf("Board schließen", () => schliessen(false))); }
    m.replaceChildren(...punkte);
    m.hidden = false;
    $("menuBtn").setAttribute("aria-expanded", "true");
    const erster = m.querySelector("button");
    if (erster) erster.focus({preventScroll: true});
  }
  $("menuBtn").addEventListener("click", (ev) => { ev.stopPropagation(); $("menu").hidden ? menuAuf() : menuZu(); });
  document.addEventListener("click", (ev) => { if (!$("menu").hidden && !$("menu").contains(ev.target)) menuZu(); });

  // ------------------------------------------------------------------ Detail
  function detail(id) {
    const e = zustand.m && zustand.m.eintraege.find(x => x.id === id);
    if (!e) return;
    zustand.detailId = id;
    const info = frageInfo(e), zu = BM.ZU(e.status);
    const inhalt = [];
    inhalt.push(el("div", {class: "dtext", text: e.text}));
    inhalt.push(el("div", {class: "meta"}, metaTeile(e, info, true)));
    if (e.beschreibung) inhalt.push(el("div", {class: "dlabel", text: "Beschreibung"}), el("p", {class: "dbeschr"}, mitLinks(e.beschreibung)));
    if (info) inhalt.push(frageBox(e, info));
    if (e.notiz) inhalt.push(el("div", {class: "dlabel", text: "Notiz"}), el("div", {class: "dnotiz"}, mitLinks(e.notiz)));
    const haupt = el("div", {class: "dhaupt"},
      el("button", {type: "button", text: "Bearbeiten", onclick: () => formular(e)}),
      !zu && e.status !== "Zurückgestellt" ? el("button", {type: "button", text: e.fokus ? "★ Stern weg" : "☆ Stern", onclick: () => sternUm(id).then(r => r && detail(id))}) : null,
      zu ? el("button", {type: "button", class: "erl", text: "Wieder öffnen", onclick: () => mitEintrag(id, x => { x.status = "Offen"; }, "Wieder offen").then(r => r && detail(id))})
        : el("button", {type: "button", class: "erl", text: "✓ Erledigt", onclick: () => haken(id)}));
    inhalt.push(haupt);
    const klein = el("div", {class: "dklein"});
    if (!zu) {
      klein.append(el("div", {class: "mlabel", text: "Verschieben (ab wann wieder sichtbar)"}),
        el("div", {class: "mreihe"}, [["+1 Tag", "1t"], ["+1 Woche", "1w"], ["+1 Monat", "1m"]].map(([t, um]) =>
          el("button", {type: "button", text: t, onclick: () => mitEintrag(id, x => { BM.verschieben(x, um, heute()); }, (x) => { hinweis("Verschoben auf " + kurz(x.ab) + "."); detail(id); })}))));
    }
    klein.append(el("div", {class: "mlabel", text: "Status"}),
      el("div", {class: "mreihe"}, BM.STATUS.map(s => el("button", {type: "button", class: s === e.status ? "an" : "", text: s,
        onclick: () => s !== e.status && mitEintrag(id, x => { x.status = s; }, "Status: " + s).then(r => r && detail(id))}))));
    const weg = el("button", {type: "button", class: "weg", text: "Löschen"});
    weg.addEventListener("click", () => {
      if (!weg.classList.contains("sicher")) { weg.classList.add("sicher"); weg.textContent = "Wirklich löschen? Nochmal tippen"; return; }
      aendern(m => { const i = m.eintraege.findIndex(x => x.id === id); if (i < 0) return false; m.eintraege.splice(i, 1); return true; }, "Gelöscht").then(r => r && ebeneZu());
    });
    klein.append(el("div", {class: "mlabel", text: "Lieber „Verworfen“ als löschen: dann bleibt nachvollziehbar, was nicht gemacht wurde."}), el("div", {class: "mreihe"}, weg));
    inhalt.push(klein);
    const p = panel("", inhalt);
    p.querySelector("h3").replaceWith(el("span", {class: "pstatus", text: e.status + " · ^" + e.id}));
    ebeneZeigen(p);
  }

  function antwortZiel() {
    const n = namen().filter(x => !gleich(x, ich()));
    return n.find(x => KI_NAMEN.test(x)) || n[0] || "";
  }
  function frageBox(e, info) {
    const box = el("div", {class: "fdbox"});
    box.append(el("div", {class: "dlabel", text: "Frage an Dich"}));
    if (info.frage) box.append(el("div", {class: "frage", text: info.frage}));
    if (info.empf) box.append(el("div", {class: "empf", text: "Empfehlung: " + info.empf}));
    const wahl = {};
    if (info.liste.length) {
      const liste = el("div", {class: "entliste"});
      const ents = info.liste.map(p => {
        const d = el("div", {class: "ent"});
        const anm = el("input", {type: "text", placeholder: "Anmerkung (optional)", "aria-label": "Anmerkung zu " + p.schluessel});
        const kn = el("div", {class: "entkn"});
        const werte = p.optionen.length ? p.optionen.map(o => o[0]) : ["ja", "nein"];
        const zeichne = () => {
          d.className = "ent" + (wahl[p.schluessel] ? " ok" : "") + (wahl[p.schluessel] === "nein" ? " nein" : "");
          for (const b of kn.querySelectorAll("button")) {
            const w = b.dataset.w;
            b.className = (w === wahl[p.schluessel] ? "an" : "") + (w === "nein" ? " nein" : "") + (w === p.empfWahl ? " empfk" : "");
          }
        };
        for (const w of werte) kn.append(el("button", {type: "button", "data-w": w, text: w, onclick: () => { wahl[p.schluessel] = wahl[p.schluessel] === w ? "" : w; zeichne(); }}));
        kn.append(anm);
        d.append(el("div", {class: "enttext"}, el("span", {class: "entk", text: p.schluessel}), p.text || "",
          p.empf ? el("span", {class: "entempf", text: " (Empfehlung: " + p.empf + ")"}) : null));
        for (const [b, t] of p.optionen) d.append(el("div", {class: "entopt"}, el("b", {text: b}), " " + t));
        d.append(kn);
        p._anm = anm;
        p._zeichne = zeichne;
        zeichne();
        return d;
      });
      liste.append(...ents);
      box.append(liste);
    }
    const ta = el("textarea", {placeholder: info.liste.length ? "Zusatz für alle (optional)" : "Antwort oder Ergänzung (optional)", "aria-label": "Antwort"});
    box.append(ta);
    const ziele = namen().filter(x => !gleich(x, ich()));
    const sel = el("select", {"aria-label": "Zurück an"}, el("option", {value: "", text: "@" + (e.wer || "niemand") + " bleibt"}),
      ziele.map(z => el("option", {value: z, text: "zurück an @" + z})));
    sel.value = antwortZiel();
    if (ziele.length) box.append(el("label", {text: "Danach zuständig"}), sel);
    const fehlt = el("div", {class: "fehltext", hidden: true});
    const kn = el("div", {class: "dhaupt"});
    const zeile = () => {
      const teile = [];
      for (const p of info.liste) {
        const w = wahl[p.schluessel], a = p._anm.value.trim();
        if (w) teile.push(p.schluessel + " " + w + (a ? " (" + a + ")" : ""));
        else if (a) teile.push(p.schluessel + " offen: " + a);
      }
      return teile;
    };
    const antworten = (text) => {
      const ziel = sel.value;
      mitEintrag(e.id, x => {
        x.notiz = (x.notiz ? x.notiz + "\n" : "") + ich() + " " + stempel() + " (Board): " + BM.einzeilig(text);
        if (ziel) { x.wer = ziel; if (KI_NAMEN.test(ziel)) x.allein = true; }
        if (x.ab && x.ab > heute()) x.ab = "";
        if (x.status === "Wartet auf" || x.status === "Zurückgestellt") x.status = "Offen";
      }, "Antwort gespeichert").then(r => r && ebeneZu());
    };
    if (info.liste.length) {
      kn.append(el("button", {type: "button", text: "Rest wie empfohlen", onclick: () => {
        for (const p of info.liste) if (!wahl[p.schluessel] && p.empfWahl) { wahl[p.schluessel] = p.empfWahl; p._zeichne(); }
      }}));
      kn.append(el("button", {type: "button", class: "allesend", text: "Alle senden", onclick: () => {
        const t = zeile();
        const offen = info.liste.filter(p => !wahl[p.schluessel]).map(p => p.schluessel);
        if (!t.length && !ta.value.trim()) { fehlt.textContent = "Noch nichts gewählt."; fehlt.hidden = false; return; }
        antworten(t.join(", ") + (offen.length && !t.some(s => s.includes(" offen:")) ? (t.length ? ", " : "") + offen.join(", ") + " offen" : "") + (ta.value.trim() ? ". " + ta.value.trim() : ""));
      }}));
    } else {
      kn.append(el("button", {type: "button", class: "passt", text: "Passt", onclick: () => antworten("Passt." + (ta.value.trim() ? " " + ta.value.trim() : ""))}));
    }
    kn.append(el("button", {type: "button", text: "Nur als Notiz", title: "Schreibt Deinen Text in die Notiz, die Frage bleibt offen", onclick: () => {
      const t = [...zeile(), ta.value.trim()].filter(Boolean).join(", ");
      if (!t) { fehlt.textContent = "Erst etwas schreiben."; fehlt.hidden = false; return; }
      mitEintrag(e.id, x => { x.notiz = (x.notiz ? x.notiz + "\n" : "") + ich() + " " + stempel() + " (Board, Notiz): " + BM.einzeilig(t); }, "Notiz gespeichert")
        .then(r => r && detail(e.id));
    }}));
    box.append(kn, fehlt);
    return box;
  }

  // ------------------------------------------------------------------ Formular Neu / Bearbeiten
  function datalist(id, werte) { return el("datalist", {id}, werte.map(w => el("option", {value: w}))); }
  function formular(e) {
    const neu = !e;
    const v = e ? {...e} : {...BM.leer("Offen"), wer: ich()};
    const f = {
      text: el("input", {type: "text", value: v.text, autofocus: true, "aria-label": "Titel", maxlength: "2000"}),
      beschreibung: el("textarea", {value: v.beschreibung, "aria-label": "Beschreibung"}),
      projekt: el("input", {type: "text", value: v.projekt, list: "dlProj", autocomplete: "off", "aria-label": "Projekt"}),
      wer: el("input", {type: "text", value: v.wer, list: "dlWer", autocomplete: "off", "aria-label": "Wer"}),
      status: el("select", {"aria-label": "Status"}, BM.STATUS.map(s => el("option", {value: s, text: s}))),
      aufwand: el("select", {"aria-label": "Aufwand"}, el("option", {value: "", text: "keine Angabe"}), BM.AUFWAND.map(a => el("option", {value: a, text: AUFWAND_TEXT[a]}))),
      ab: el("input", {type: "date", value: v.ab, "aria-label": "Ab"}),
      frist: el("input", {type: "date", value: v.frist, "aria-label": "Frist"}),
      alle: el("select", {"aria-label": "Wiederholen"}, el("option", {value: "", text: "nicht"}), Object.keys(ALLE_TEXT).map(a => el("option", {value: a, text: ALLE_TEXT[a]}))),
      allein: el("input", {type: "checkbox", checked: v.allein}),
      notiz: el("textarea", {value: v.notiz, class: "gross", "aria-label": "Notiz"}),
    };
    f.status.value = v.status;
    f.aufwand.value = v.aufwand;
    if (v.alle && !ALLE_TEXT[v.alle]) f.alle.append(el("option", {value: v.alle, text: alleText(v.alle)}));
    f.alle.value = v.alle;
    const fehlt = el("div", {class: "fehltext", hidden: true});
    const lies = () => ({
      text: BM.einzeilig(f.text.value), beschreibung: BM.mehrzeilig(f.beschreibung.value),
      projekt: f.projekt.value.trim().replace(/^#/, "").toLowerCase(), wer: BM.einzeilig(f.wer.value).replace(/^@/, ""),
      status: f.status.value, aufwand: f.aufwand.value, ab: f.ab.value, frist: f.frist.value, alle: f.alle.value,
      allein: f.allein.checked, notiz: BM.mehrzeilig(f.notiz.value),
    });
    const alt = lies();
    const speichern = () => {
      const w = lies();
      if (!w.text) { fehlt.textContent = "Bitte einen Titel eingeben."; fehlt.hidden = false; f.text.focus(); return; }
      if (w.projekt && !BM.PROJ_RE.test("#" + w.projekt)) { fehlt.textContent = "Projekt nur aus Buchstaben, Ziffern, - und _ (mit Buchstabe vorn)."; fehlt.hidden = false; return; }
      const kuerzen = (x) => {
        if (x.text.length > BM.TITEL_LANG) { x.beschreibung = x.text + (x.beschreibung ? "\n" + x.beschreibung : ""); x.text = BM.titelKurz(x.text); }
      };
      if (neu) {
        aendern(m => {
          const x = Object.assign(BM.leer(w.status), w, {seit: heute()});
          kuerzen(x);
          m.eintraege.unshift(x);
          return x;
        }, "Angelegt").then(x => { if (x) { zustand.tab = x.status; ebeneWeg(); render(); } });
      } else {
        mitEintrag(e.id, x => {
          for (const k of Object.keys(w)) if (w[k] !== alt[k]) x[k] = w[k];
          kuerzen(x);
        }, "Gespeichert").then(r => r && detail(e.id));
      }
    };
    const feld = (t, x) => [el("label", {text: t}), x];
    const inhalt = el("form", {onsubmit: (ev) => { ev.preventDefault(); speichern(); }},
      feld("Titel", f.text),
      feld("Beschreibung", f.beschreibung),
      el("div", {class: "zeile2"}, el("div", null, feld("Projekt", f.projekt)), el("div", null, feld("Wer (zuständig)", f.wer))),
      datalist("dlProj", projekte()), datalist("dlWer", namen()),
      el("div", {class: "zeile2"}, el("div", null, feld("Status", f.status)), el("div", null, feld("Aufwand", f.aufwand))),
      el("div", {class: "zeile2"}, el("div", null, feld("Ab (vorher ausgeblendet)", f.ab)), el("div", null, feld("Frist", f.frist))),
      feld("Wiederholen", f.alle),
      el("label", {class: "haekchen"}, f.allein, "Allein machbar (ohne Rückfrage)"),
      feld("Notiz", f.notiz),
      fehlt,
      el("div", {class: "knoepfe"}, el("button", {type: "submit", class: "speichern", text: neu ? "Anlegen" : "Speichern"}),
        el("button", {type: "button", text: "Abbrechen", onclick: () => neu ? ebeneZu() : detail(e.id)})));
    ebeneZeigen(panel(neu ? "Neue Aufgabe" : "Bearbeiten", inhalt));
  }

  // ------------------------------------------------------------------ Einrichtung (schreibt in den Kopf der Datei)
  function standardPrompt(namenListe) {
    const n = namenListe.filter(x => !KI_NAMEN.test(x));
    const ki = namenListe.find(x => KI_NAMEN.test(x)) || "KI";
    const wer = n[0] || "NAME";
    return [
      "Du hilfst " + (n.length ? n.join(" und ") : "mir") + " mit dieser Aufgabenliste (Board-Datei im Markdown-Format).",
      "Bearbeite nur Aufgaben mit @" + ki + ". Schreibe Deinen Stand als eingerückte Zeile unter die Aufgabe, mit Datum.",
      "Brauchst Du eine Entscheidung, schreibe eine Zeile „BRAUCHT " + wer.toUpperCase() + ": Frage. Empfehlung: Dein Tipp“ und setze @" + wer + ".",
      "Mehrere Entscheidungen: je Zeile „E1 Frage (Empfehlung)“, Auswahl als „a …; b …“.",
      "Lösche nichts. Erledigtes bekommt [x] und steht unter „## Erledigt“.",
    ].join("\n");
  }
  function einrichtung(neuesBoard, fertig) {
    const c = cfg();
    const f = {
      titel: el("input", {type: "text", value: c.titel || (neuesBoard && Q ? Q.name.replace(/\.(md|markdown|txt)$/i, "") : ""), autofocus: true, placeholder: "z. B. Familie Muster"}),
      namen: el("input", {type: "text", value: c.namen.join(", "), placeholder: "z. B. Anna, Ben, KI"}),
      ich: el("input", {type: "text", value: ich(), list: "dlIch", placeholder: "Dein Name aus der Liste"}),
      projekte: el("input", {type: "text", value: c.projekte.join(", "), placeholder: "z. B. haushalt, garten, arbeit"}),
      prompt: el("textarea", {class: "gross", value: c.prompt}),
    };
    const dl = el("datalist", {id: "dlIch"});
    const dlNeu = () => dl.replaceChildren(...BM.liste(f.namen.value).map(n => el("option", {value: n})));
    f.namen.addEventListener("input", dlNeu);
    dlNeu();
    const vorschlag = el("button", {type: "button", text: "Vorschlag einsetzen", onclick: () => { f.prompt.value = standardPrompt(BM.liste(f.namen.value)); }});
    const fehlt = el("div", {class: "fehltext", hidden: true});
    const speichern = () => {
      const projekteWerte = BM.liste(f.projekte.value).map(p => p.toLowerCase());
      const falsch = projekteWerte.find(p => !BM.PROJ_RE.test("#" + p));
      if (falsch) { fehlt.textContent = "„" + falsch + "“ geht nicht als Projekt: nur Buchstaben, Ziffern, - und _ (mit Buchstabe vorn), keine Leerzeichen."; fehlt.hidden = false; return; }
      const neu = {titel: BM.einzeilig(f.titel.value), namen: BM.liste(f.namen.value), projekte: projekteWerte, prompt: f.prompt.value.trim()};
      LS.set("ich", BM.einzeilig(f.ich.value));
      aendern(m => { m.kopf = BM.kopfSchreiben(m.kopf, neu); m.cfg = BM.kopfLesen(m.kopf); return true; }, "Einrichtung gespeichert")
        .then(r => { if (r) { ebeneWeg(); if (fertig) fertig(); } });
    };
    const feld = (t, x, hilfe) => [el("label", {text: t}), x, hilfe ? el("p", {class: "hilfe", text: hilfe}) : null];
    const inhalt = el("form", {onsubmit: (ev) => { ev.preventDefault(); speichern(); }},
      el("p", {class: "hilfe", text: "Das steht danach oben in Deiner Datei. Du kannst es dort auch von Hand ändern."}),
      feld("Name des Boards", f.titel),
      feld("Namen (mit Komma getrennt)", f.namen, "Alle, die Aufgaben bekommen. Auch Deine KI, z. B. „KI“."),
      feld("Wer bin ich auf diesem Gerät?", f.ich, "Wird nur in diesem Browser gemerkt, nicht in der Datei."), dl,
      feld("Projekte (mit Komma getrennt)", f.projekte, "Kleinbuchstaben ohne Leerzeichen. In Aufgaben als #projekt."),
      feld("Prompt für Deine KI", f.prompt, "Arbeitsanweisung für eine KI, die die Datei mitbearbeitet. Steht in der Datei unter „### Prompt“."),
      el("div", {class: "mreihe"}, vorschlag),
      fehlt,
      el("div", {class: "knoepfe"}, el("button", {type: "submit", class: "speichern", text: "In die Datei schreiben"}),
        el("button", {type: "button", text: "Abbrechen", onclick: ebeneZu})));
    if (neuesBoard && !f.prompt.value) f.prompt.value = standardPrompt(c.namen);
    ebeneZeigen(panel(neuesBoard ? "Neues Board einrichten" : "Einrichtung", inhalt));
  }

  function waehleIch() {
    const n = namen();
    const eingabe = el("input", {type: "text", value: ich(), list: "dlIch2", autofocus: true});
    const inhalt = el("form", {onsubmit: (ev) => { ev.preventDefault(); LS.set("ich", BM.einzeilig(eingabe.value)); ebeneZu(); render(); }},
      el("p", {class: "hilfe", text: "Damit die Maske Fragen an Dich erkennt („BRAUCHT NAME: …“). Wird nur in diesem Browser gemerkt."}),
      n.length ? el("div", {class: "mreihe"}, n.map(x => el("button", {type: "button", text: x, onclick: () => { LS.set("ich", x); ebeneZu(); render(); }}))) : null,
      el("label", {text: "Oder Name eingeben"}), eingabe, datalist("dlIch2", n),
      el("div", {class: "knoepfe"}, el("button", {type: "submit", class: "speichern", text: "Übernehmen"})));
    ebeneZeigen(panel("Wer bist Du?", inhalt, true));
  }

  // ------------------------------------------------------------------ Prompt fuer die KI
  const FORMAT_HILFE = [
    "So ist die Datei aufgebaut (bitte genau so schreiben, sonst kann die Board-Maske sie nicht lesen):",
    "- Abschnitte als Überschriften: ## Offen, ## Wartet auf, ## Zurückgestellt, ## Erledigt, ## Verworfen.",
    "- Eine Aufgabe ist eine Zeile: - [ ] Titel #projekt @wer allein:ja alle:1w aufwand:u30m ab:JJJJ-MM-TT frist:JJJJ-MM-TT seit:JJJJ-MM-TT ^id",
    "  Nur Titel und ^id sind Pflicht. ^id sind 6 Zeichen 0-9a-f und bleiben immer gleich. Neue Aufgaben ohne ^id ergänzt die Maske selbst.",
    "  aufwand: u5m, u30m, u2h oder ab2h. alle: Zahl plus t, w, m oder j (wiederholen). fokus:JJJJ-MM-TT ist der Stern.",
    "- Erledigt: - [x] ... erledigt:JJJJ-MM-TT unter ## Erledigt. Verworfen: - [-] ... verworfen:JJJJ-MM-TT unter ## Verworfen.",
    "- Darunter eingerückt (zwei Leerzeichen): zuerst Zeilen „Beschreibung: …“, dann die Notiz, Zeile für Zeile.",
    "- Fragen an einen Menschen als Notizzeile: BRAUCHT NAME: Frage. Empfehlung: Tipp. Die Antwort kommt als Zeile „Name TT.MM. HH:MM (Board): …“.",
    "- Mehrere Entscheidungen darunter je Zeile: E1 Frage (Empfehlung). Mit Auswahl: E2 Thema: a Option; b Option (b).",
    "- Alles über der ersten ##-Überschrift ist der Kopf (Name, Namen:, Projekte:, ### Prompt). Nichts löschen, was Du nicht verstehst.",
  ].join("\n");
  function promptText() {
    const c = cfg();
    return (c.prompt ? c.prompt + "\n\n" : "") + "Die Datei heißt " + (Q ? Q.name : "board.md") + ".\n" + FORMAT_HILFE;
  }
  function promptZeigen() {
    const text = promptText();
    const pre = el("pre", {class: "prompt", text});
    const kopieren = el("button", {type: "button", class: "speichern", text: "Kopieren", onclick: async () => {
      try { await navigator.clipboard.writeText(text); hinweis("Prompt kopiert."); }
      catch (e) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); hinweis("Text ist markiert: jetzt Strg+C bzw. Kopieren."); }
    }});
    ebeneZeigen(panel("Prompt für Deine KI", [el("p", {class: "hilfe", text: "Gib diesen Text Deiner KI (z. B. einem Coding-Assistenten mit Zugriff auf die Datei). Der erste Teil kommt aus Deiner Einrichtung, der Rest erklärt das Format."}),
      pre, el("div", {class: "knoepfe"}, kopieren)]));
  }

  // ------------------------------------------------------------------ Dateien
  async function vorWechsel() {
    if (Q && Q.art === "kopie" && Q.ungesichert) {
      const w = await frage("Noch nicht gesichert", "Deine Änderungen an „" + Q.name + "“ stehen nur in diesem Browser. Erst herunterladen?",
        [["Herunterladen", "laden"], ["Ohne Sichern weiter", "weiter"], ["Abbrechen", ""]]);
      if (w === "laden") { await herunterladen(); return true; }
      return w === "weiter";
    }
    return true;
  }
  async function oeffnen() {
    if (!(await vorWechsel())) return;
    if (KANN_DATEI) {
      let h;
      try {
        [h] = await window.showOpenFilePicker({multiple: false, types: [{description: "Board (Markdown)", accept: {"text/markdown": [".md", ".markdown"], "text/plain": [".txt"]}}]});
      } catch (e) { if (e.name !== "AbortError") fehler(e); return; }
      try {
        if ((await h.requestPermission({mode: "readwrite"})) !== "granted") { hinweis("Ohne Schreibrecht kann ich nichts speichern."); return; }
        Q = {art: "handle", handle: h, name: h.name};
        zustand.recht = true;
        await DB.set("quelle", {art: "handle", handle: h, name: h.name});
        await laden();
      } catch (e) { fehler(e); }
      return;
    }
    $("dateiWahl").value = "";
    $("dateiWahl").click();
  }
  $("dateiWahl").addEventListener("change", async () => {
    const d = $("dateiWahl").files[0];
    if (!d) return;
    try {
      const text = await d.text();
      await DB.set("kopie", {name: d.name, text, ungesichert: false});
      Q = {art: "kopie", name: d.name, ungesichert: false};
      await DB.set("quelle", {art: "kopie", name: d.name});
      await laden();
      hinweis("Arbeitskopie im Browser. Mit „Herunterladen“ sicherst Du sie wieder als Datei.");
    } catch (e) { fehler(e); }
  });

  async function anlegen() {
    if (!(await vorWechsel())) return;
    const c = {titel: "", namen: [], projekte: [], prompt: ""};
    zustand.m = {kopf: [], eintraege: [], frei: {}, cfg: c};
    const f = {
      titel: el("input", {type: "text", autofocus: true, placeholder: "z. B. Familie Muster"}),
      namen: el("input", {type: "text", placeholder: "z. B. Anna, Ben, KI"}),
      projekte: el("input", {type: "text", placeholder: "z. B. haushalt, garten, arbeit"}),
    };
    const fehlt = el("div", {class: "fehltext", hidden: true});
    const los = async () => {
      const projekteWerte = BM.liste(f.projekte.value).map(p => p.toLowerCase());
      const falsch = projekteWerte.find(p => !BM.PROJ_RE.test("#" + p));
      if (falsch) { fehlt.textContent = "„" + falsch + "“ geht nicht als Projekt (nur Buchstaben, Ziffern, - und _)."; fehlt.hidden = false; return; }
      const namenWerte = BM.liste(f.namen.value);
      const neu = {titel: BM.einzeilig(f.titel.value) || "Board", namen: namenWerte, projekte: projekteWerte, prompt: standardPrompt(namenWerte)};
      const text = BM.neueDatei(neu);
      const dateiname = (neu.titel.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "-").replace(/^-|-$/g, "") || "board") + ".md";
      if (namenWerte.length && !ich()) LS.set("ich", namenWerte[0]);
      try {
        if (typeof window.showSaveFilePicker === "function") {
          let h;
          try { h = await window.showSaveFilePicker({suggestedName: dateiname, types: [{description: "Board (Markdown)", accept: {"text/markdown": [".md"]}}]}); }
          catch (e) { if (e.name === "AbortError") return; throw e; }
          Q = {art: "handle", handle: h, name: h.name};
          zustand.recht = true;
          await quelleSchreiben(text);
          await DB.set("quelle", {art: "handle", handle: h, name: h.name});
        } else {
          Q = {art: "kopie", name: dateiname, ungesichert: true};
          await DB.set("kopie", {name: dateiname, text, ungesichert: true});
          await DB.set("quelle", {art: "kopie", name: dateiname});
        }
        ebeneWeg();
        await laden();
        hinweis(Q.art === "handle" ? "Board angelegt: " + Q.name : "Board angelegt. Mit „Herunterladen“ bekommst Du die Datei.");
      } catch (e) { fehler(e); }
    };
    const feld = (t, x, hilfe) => [el("label", {text: t}), x, hilfe ? el("p", {class: "hilfe", text: hilfe}) : null];
    ebeneZeigen(panel("Neues Board", el("form", {onsubmit: (ev) => { ev.preventDefault(); los(); }},
      feld("Name des Boards", f.titel),
      feld("Namen (mit Komma getrennt)", f.namen, "Alle, die Aufgaben bekommen, auch Deine KI. Der erste Name bist Du."),
      feld("Projekte (mit Komma getrennt)", f.projekte, "Kleinbuchstaben ohne Leerzeichen. Später jederzeit änderbar."),
      el("p", {class: "hilfe", text: KANN_DATEI ? "Danach wählst Du, wo die Datei liegen soll." : "Dein Browser speichert die Datei zuerst nur intern; mit „Herunterladen“ bekommst Du sie."}),
      fehlt,
      el("div", {class: "knoepfe"}, el("button", {type: "submit", class: "speichern", text: "Board anlegen"}), el("button", {type: "button", text: "Abbrechen", onclick: ebeneZu})))));
  }

  async function herunterladen() {
    try {
      const text = await quelleLesen();
      const url = URL.createObjectURL(new Blob([text], {type: "text/markdown;charset=utf-8"}));
      const a = el("a", {href: url, download: (Q && Q.name) || "board.md"});
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (Q.art === "kopie" && !Q.beispiel) {
        const k = await DB.get("kopie");
        if (k) { k.ungesichert = false; await DB.set("kopie", k); }
        Q.ungesichert = false;
        renderSpeicher();
      }
    } catch (e) { fehler(e); }
  }
  async function teilen() {
    try {
      const text = await quelleLesen();
      const datei = new File([text], Q.name || "board.md", {type: "text/markdown"});
      if (!navigator.canShare({files: [datei]})) { hinweis("Teilen von Dateien geht in diesem Browser nicht. Bitte herunterladen."); return; }
      await navigator.share({files: [datei], title: Q.name});
      if (!Q.beispiel) { const k = await DB.get("kopie"); if (k) { k.ungesichert = false; await DB.set("kopie", k); } Q.ungesichert = false; renderSpeicher(); }
    } catch (e) { if (e.name !== "AbortError") fehler(e); }
  }
  async function schliessen(still) {
    if (!still && !(await vorWechsel())) return;
    Q = null;
    zustand.m = null;
    await DB.del("quelle");
    await DB.del("kopie");      // nichts vom Board bleibt im Browser zurueck
    $("kopf").hidden = true;
    $("spalten").hidden = true;
    $("start").hidden = false;
    document.title = "Board-Maske";
    startZeigen();
  }
  async function beispiel() {
    if (!(await vorWechsel())) return;
    await DB.set("kopie", {name: "beispiel.md", text: BEISPIEL, ungesichert: false, beispiel: true});
    await DB.set("quelle", {art: "kopie", name: "beispiel.md", beispiel: true});
    Q = {art: "kopie", name: "beispiel.md", beispiel: true};
    await laden();
  }

  $("speicherBtn").addEventListener("click", async () => {
    if (!Q) return;
    if (Q.art === "handle" && !zustand.recht) {
      if (await rechtSichern(true)) { try { await laden(); } catch (e) { fehler(e); } }
      return;
    }
    if (Q.art === "kopie" && Q.ungesichert) { herunterladen(); return; }
    const text = Q.art === "handle" ? "Jede Änderung wird sofort in „" + Q.name + "“ gespeichert. Ändert jemand anderes die Datei (z. B. Deine KI), lädt die Maske sie nach ein paar Sekunden neu."
      : Q.art === "server" ? "Die Datei liegt auf Deinem PC. Die Maske spricht nur mit dem kleinen Board-Dienst dort, über Dein eigenes Netz oder VPN."
      : Q.beispiel ? "Das Beispiel steht nur in diesem Browser. Probier ruhig alles aus."
      : "Dein Browser kann die Datei nicht direkt zurückschreiben. Die Maske arbeitet mit einer Kopie in diesem Browser. Mit „Herunterladen“ sicherst Du sie als Datei.";
    const w = await frage("Wo wird gespeichert?", text, [["Gut", ""], ["Herunterladen (Sicherung)", "laden"]]);
    if (w === "laden") herunterladen();
  });
  $("neuBtn").addEventListener("click", () => formular(null));
  $("suche").addEventListener("input", () => { zustand.suche = $("suche").value; renderLeisten(); renderSpalten(); });
  $("oeffnenBtn").addEventListener("click", oeffnen);
  $("anlegenBtn").addEventListener("click", anlegen);
  $("beispielBtn").addEventListener("click", beispiel);

  document.addEventListener("keydown", (ev) => {
    const inFeld = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (ev.key === "Escape") { if (!$("menu").hidden) menuZu(); else if (!$("ebene").hidden) ebeneZu(); else if (inFeld) document.activeElement.blur(); return; }
    if (inFeld || ev.ctrlKey || ev.metaKey || ev.altKey || !zustand.m || !$("ebene").hidden) return;
    if (ev.key === "/") { ev.preventDefault(); $("suche").focus(); }
    else if (ev.key === "n") { ev.preventDefault(); formular(null); }
  });

  // ------------------------------------------------------------------ Start
  async function startZeigen() {
    $("faehigkeit").textContent = KANN_DATEI
      ? "Dein Browser kann die Datei direkt speichern: sie bleibt, wo sie ist, und jede Änderung landet sofort darin."
      : "Dein Browser kann Dateien nicht direkt zurückschreiben (z. B. Firefox, Safari oder Chrome auf dem Handy). Die Maske arbeitet dann mit einer Kopie im Browser; mit „Herunterladen“ sicherst Du sie als Datei. Direkt speichern geht in Chrome oder Edge am PC.";
    const box = $("weiterBox");
    box.hidden = true;
    box.replaceChildren();
    const q = await DB.get("quelle");
    if (!q) return;
    if (q.art === "kopie") {
      const k = await DB.get("kopie");
      if (!k) return;
      Q = {art: "kopie", name: k.name, ungesichert: !!k.ungesichert, beispiel: !!k.beispiel};
      try { await laden(); } catch (e) { fehler(e); }
      return;
    }
    if (q.art === "handle" && q.handle) {
      const h = q.handle;
      let r = "prompt";
      try { r = await h.queryPermission({mode: "readwrite"}); } catch (e) { /* alter Browser */ }
      if (r === "granted") { Q = {art: "handle", handle: h, name: h.name}; zustand.recht = true; try { await laden(); } catch (e) { fehler(e); } return; }
      box.append(el("button", {type: "button", class: "gross", text: "Weiter mit „" + h.name + "“", onclick: async () => {
        try {
          if ((await h.requestPermission({mode: "readwrite"})) !== "granted") { hinweis("Ohne Erlaubnis kann ich die Datei nicht lesen."); return; }
          Q = {art: "handle", handle: h, name: h.name};
          zustand.recht = true;
          await laden();
        } catch (e) { fehler(e); }
      }}));
      box.hidden = false;
    }
  }

  (async () => {
    if (SERVER) {
      Q = {art: "server", name: "board.md"};
      try { await laden(); } catch (e) { fehler(e); }
      return;
    }
    if (location.hash === "#beispiel") { await beispiel(); return; }
    await startZeigen();
  })();
})();
