// Browsertest der gebauten Maske ueber das DevTools-Protokoll (Edge oder Chrome headless). Nur Node 22, keine Pakete.
//   node test/browser.js <version> <bilderordner>
// Startet board_lokal.py mit einer KOPIE von beispiel.md in einem temporaeren Ordner, klickt die wichtigsten Wege durch,
// prueft die Datei danach, sammelt Konsolenfehler, CSP-Verstoesse und Netzanfragen und macht Bildschirmfotos (JPEG).
"use strict";
const {spawn} = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const WURZEL = path.resolve(__dirname, "..");
const VERSION = process.argv[2] || "v1";
const BILDER = path.resolve(process.argv[3] || path.join(os.tmpdir(), "bm_bilder"));
const PORT_DIENST = 8791, PORT_CDP = 9339;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bm_browser_"));
const BOARD = path.join(TMP, "board.md");
fs.copyFileSync(path.join(WURZEL, "src", "beispiel.md"), BOARD);
fs.mkdirSync(BILDER, {recursive: true});

const BROWSER = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(p => fs.existsSync(p));
const warte = (ms) => new Promise(r => setTimeout(r, ms));
const ergebnisse = [];
function pruefe(name, ok, info) { ergebnisse.push([name, !!ok]); console.log((ok ? "ok    " : "FEHLT ") + name + (!ok && info ? "  " + info : "")); }

let ws, nr = 0;
const offen = new Map(), ereignisse = [];
function cdp(method, params = {}, sessionId) {
  const id = ++nr;
  ws.send(JSON.stringify({id, method, params, sessionId}));
  return new Promise((ok, nein) => offen.set(id, {ok, nein, method}));
}

async function main() {
  const dienst = spawn("python", [path.join(WURZEL, VERSION, "board_lokal.py"), "--datei", BOARD, "--port", String(PORT_DIENST)], {stdio: ["ignore", "pipe", "pipe"]});
  let dienstLog = "";
  dienst.stderr.on("data", d => { dienstLog += d; });
  const profil = path.join(TMP, "profil");
  const br = spawn(BROWSER, ["--headless=new", "--remote-debugging-port=" + PORT_CDP, "--user-data-dir=" + profil, "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", "--disable-sync", "--disable-background-networking", "--disable-component-update", "about:blank"], {stdio: "ignore"});
  let info;
  for (let i = 0; i < 50 && !info; i++) { await warte(200); try { info = await (await fetch("http://127.0.0.1:" + PORT_CDP + "/json/version")).json(); } catch (e) { /* noch nicht */ } }
  ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && offen.has(m.id)) { const o = offen.get(m.id); offen.delete(m.id); m.error ? o.nein(new Error(o.method + ": " + m.error.message)) : o.ok(m.result); }
    else if (m.method) ereignisse.push(m);
  });

  const {targetId} = await cdp("Target.createTarget", {url: "about:blank"});
  const {sessionId: S} = await cdp("Target.attachToTarget", {targetId, flatten: true});
  const c = (m, p) => cdp(m, p, S);
  await c("Page.enable"); await c("Runtime.enable"); await c("Log.enable"); await c("Network.enable");
  const ev = async (expr) => {
    const r = await c("Runtime.evaluate", {expression: expr, awaitPromise: true, returnByValue: true});
    if (r.exceptionDetails) throw new Error("JS: " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const bis = async (expr, ms = 6000) => { for (let t = 0; t < ms; t += 100) { if (await ev(expr)) return true; await warte(100); } return false; };
  const geh = async (url) => { await c("Page.navigate", {url}); await warte(300); await bis("document.readyState === 'complete'"); await warte(400); };
  const groesse = (w, h, mobil) => c("Emulation.setDeviceMetricsOverride", {width: w, height: h, deviceScaleFactor: 1, mobile: !!mobil});
  const farbe = (dunkel) => c("Emulation.setEmulatedMedia", {features: [{name: "prefers-color-scheme", value: dunkel ? "dark" : "light"}]});
  const foto = async (name) => {
    const r = await c("Page.captureScreenshot", {format: "jpeg", quality: 78});
    fs.writeFileSync(path.join(BILDER, name + ".jpg"), Buffer.from(r.data, "base64"));
  };
  const klick = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
  const klickText = (sel, text) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!e) return false; e.click(); return true; })()`);
  const datei = () => fs.readFileSync(BOARD, "utf8");

  // ---------------- A: Datei-Variante (file://) mit dem Beispiel
  await groesse(1280, 800); await farbe(false);
  const dateiUrl = "file:///" + path.join(WURZEL, VERSION, "index.html").replace(/\\/g, "/");
  await geh(dateiUrl);
  pruefe("Startseite zeigt drei Knöpfe", await ev("['oeffnenBtn','anlegenBtn','beispielBtn'].every(id => !document.getElementById(id).hidden)"));
  await foto("pc_start_hell");
  await klick("#beispielBtn");
  pruefe("Beispiel lädt (Karten sichtbar)", await bis("document.querySelectorAll('.karte').length >= 7"));
  await ev("localStorage.setItem('bm.ich', JSON.stringify('Anna'))");
  await geh(dateiUrl);
  pruefe("Beispiel bleibt nach Neuladen", await bis("document.querySelectorAll('.karte').length >= 7"));
  pruefe("Chip „Fragen an mich 1“", await ev("[...document.querySelectorAll('.chip')].some(c => c.textContent.startsWith('Fragen an mich 1'))"));
  await foto("pc_board_hell");
  await farbe(true); await warte(200); await foto("pc_board_dunkel"); await farbe(false);

  // Filter: Projekt-Chip, Suche
  const alleKarten = await ev("document.querySelectorAll('.s-offen .karte').length");
  await klickText(".pchip", "#garten"); await warte(150);
  const gefiltert = await ev("document.querySelectorAll('.s-offen .karte').length");
  pruefe("Projektfilter verkleinert die Liste", gefiltert > 0 && gefiltert < alleKarten, alleKarten + " -> " + gefiltert);
  await klickText(".pchip", "#garten"); await warte(100);
  await ev("(() => { const s = document.getElementById('suche'); s.value = 'zzzzunbekannt'; s.dispatchEvent(new Event('input')); })()"); await warte(100);
  pruefe("Suche ohne Treffer zeigt Hinweis", await ev("document.querySelector('.s-offen .leer') !== null"));
  await ev("(() => { const s = document.getElementById('suche'); s.value = ''; s.dispatchEvent(new Event('input')); })()");

  // Detail mit Entscheidungsliste
  await klick('.karte[data-id="d4e5f6"]');
  pruefe("Detail mit Entscheidungsliste (3 Punkte)", await bis("document.querySelectorAll('.entliste .ent').length === 3"));
  await foto("pc_detail_hell");
  await ev("history.state && history.state.ebene ? history.back() : document.querySelector('.zu-btn').click()"); await warte(300);
  pruefe("Zurück schließt das Popup", await ev("document.getElementById('ebene').hidden"));

  // ---------------- B: Dienst-Variante (board_lokal.py) mit Datei-Kopie
  const dienstUrl = "http://127.0.0.1:" + PORT_DIENST + "/";
  await geh(dienstUrl);
  await ev("localStorage.setItem('bm.ich', JSON.stringify('Anna'))");
  await geh(dienstUrl);
  pruefe("Dienst: Board lädt", await bis("document.querySelectorAll('.karte').length >= 7"));
  pruefe("Dienst: Speicherstand zeigt PC", await ev("document.getElementById('speicherBtn').textContent.includes('PC')"));

  // Abhaken einer einfachen und einer wiederkehrenden Aufgabe
  await ev(`document.querySelector('.karte[data-id="abcdef"] .haken').click()`);
  pruefe("Abhaken schreibt [x] und erledigt:", await bis(`/- \\[x\\] .*erledigt:\\d{4}-\\d{2}-\\d{2}.*\\^abcdef/.test(${JSON.stringify("")} + '')`, 10) || (await warte(1200), /- \[x\] .*erledigt:\d{4}-\d{2}-\d{2}.*\^abcdef/.test(datei())));
  await ev(`document.querySelector('.karte[data-id="f1f2f3"] .haken').click()`); await warte(1200);
  const f3 = datei().split("\n").find(z => z.includes("^f1f2f3")) || "";
  pruefe("Wiederkehrende Aufgabe springt weiter (ab:, zuletzt:, bleibt offen)", /^- \[ \] .*ab:\d{4}.*zuletzt:\d{4}/.test(f3) && !/fokus:/.test(f3), f3);

  // Frage beantworten: Rest wie empfohlen, Alle senden
  await klick('.karte[data-id="d4e5f6"]');
  await bis("document.querySelectorAll('.entliste .ent').length === 3");
  await ev("[...document.querySelectorAll('.entkn button')].find(b => b.dataset.w === 'a').click()");
  await klickText(".fdbox button", "Rest wie empfohlen");
  await ev("document.querySelector('.entkn input').value = 'aber günstig'");
  await foto("pc_detail_ausgefuellt");
  await klickText(".fdbox button", "Alle senden"); await warte(1200);
  const d6 = datei().split("\n"), i6 = d6.findIndex(z => z.includes("^d4e5f6"));
  const antwort = d6.slice(i6, i6 + 20).find(z => /Anna \d\d\.\d\d\. \d\d:\d\d \(Board\):/.test(z)) || "";
  pruefe("Antwortzeile in der Notiz", /E1 a \(aber günstig\), E2 ja, E3 nein/.test(antwort), antwort);
  pruefe("Zuständig zurück an @KI", /@KI\b/.test(d6[i6]), d6[i6]);
  pruefe("Frage gilt danach als beantwortet", await ev("[...document.querySelectorAll('.chip')].some(c => c.textContent.startsWith('Fragen an mich 0'))"));

  // Neue Aufgabe
  await klick("#neuBtn"); await bis("document.querySelector('.panel form') !== null");
  await ev(`(() => { const f = document.querySelector('.panel form'); const i = f.querySelectorAll('input'); i[0].value = 'Testaufgabe aus dem Browser'; i[1].value = 'garten'; f.querySelector('select[aria-label=Aufwand]').value = 'u30m'; f.requestSubmit(); })()`);
  await warte(1200);
  const neu = datei().split("\n").find(z => z.includes("Testaufgabe aus dem Browser")) || "";
  pruefe("Neue Aufgabe mit #projekt, aufwand, seit, ^id", /^- \[ \] Testaufgabe aus dem Browser #garten @Anna aufwand:u30m seit:\d{4}-\d{2}-\d{2} \^[0-9a-f]{6}$/.test(neu), neu);

  // Fremde Aenderung waehrend die Seite offen ist (KI schreibt in die Datei), dann eigene Aenderung: nichts geht verloren
  fs.writeFileSync(BOARD, datei().replace("## Wartet auf", "- [ ] Von der KI eingetragen #arbeit @KI ^fe0001\n\n## Wartet auf"));
  pruefe("Fremde Änderung erscheint ohne Neuladen", await bis(`document.querySelector('.karte[data-id="fe0001"]') !== null`, 9000));
  await ev(`document.querySelector('.karte[data-id="c0ffee"] .stern').click()`); await warte(1200);
  pruefe("Eigene Änderung danach behält die fremde Zeile", datei().includes("^fe0001") && /fokus:\d{4}-\d{2}-\d{2} \^c0ffee/.test(datei()));

  // Einrichtung: Projekte ergaenzen
  await ev("document.getElementById('menuBtn').click()"); await warte(150);
  await klickText("#menu button", "Einrichtung");
  await bis("document.querySelector('.panel form') !== null");
  await foto("pc_einrichtung");
  await ev(`(() => { const f = document.querySelector('.panel form'); const i = f.querySelectorAll('input'); i[3].value = i[3].value + ', urlaub'; f.requestSubmit(); })()`);
  await warte(1200);
  pruefe("Einrichtung schreibt Projekte in den Kopf", /^Projekte: .*urlaub/m.test(datei().split("## Offen")[0]));

  // Konflikt: Datei wird zwischen Lesen und Schreiben geaendert -> Dienst lehnt ab (412)
  const r1 = await fetch(dienstUrl + "board.md"); const tag = r1.headers.get("etag"); await r1.text();
  fs.writeFileSync(BOARD, datei() + "\n");
  const r2 = await fetch(dienstUrl + "board.md", {method: "PUT", body: "kaputt", headers: {"If-Match": tag}});
  pruefe("Dienst: veraltetes If-Match bekommt 412", r2.status === 412, String(r2.status));
  const r3 = await fetch(dienstUrl + "board.md", {method: "PUT", body: "x", headers: {"If-Match": "*", "Origin": "http://evil.example"}});
  pruefe("Dienst: fremder Origin bekommt 403", r3.status === 403, String(r3.status));
  // fetch() verwirft den Host-Kopf still, deshalb http.request
  const r4 = await new Promise((ok, nein) => require("http").get({host: "127.0.0.1", port: PORT_DIENST, path: "/board.md", headers: {Host: "evil.example"}}, (r) => { r.resume(); ok(r.statusCode); }).on("error", nein));
  pruefe("Dienst: fremder Host-Kopf bekommt 403", r4 === 403, String(r4));
  pruefe("Datei nicht überschrieben", !datei().startsWith("kaputt") && datei() !== "x");

  // ---------------- Handy-Breite
  await groesse(390, 844, true); await farbe(false);
  await geh(dienstUrl);
  await bis("document.querySelectorAll('.karte').length >= 5");
  pruefe("Handy: Tabs sichtbar, nur eine Spalte", await ev("getComputedStyle(document.getElementById('tabs')).display !== 'none' && document.querySelectorAll('.spalte:not(.aus)').length === 1"));
  pruefe("Handy: keine waagerechte Scrollleiste", await ev("document.documentElement.scrollWidth <= innerWidth + 1"), await ev("document.documentElement.scrollWidth"));
  await foto("handy_board_hell");
  await farbe(true); await warte(200); await foto("handy_board_dunkel"); await farbe(false);
  // Frage im Beispiel ist beantwortet; fuer das Handyfoto die Frage-Karte aus dem file://-Beispiel nehmen
  await geh(dateiUrl);
  await bis("document.querySelectorAll('.karte').length >= 5");
  await klick('.karte[data-id="d4e5f6"]'); await bis("document.querySelectorAll('.entliste .ent').length === 3");
  await foto("handy_detail_hell");
  await farbe(true); await warte(200); await foto("handy_detail_dunkel"); await farbe(false);
  await ev("document.querySelector('.zu-btn').click()"); await warte(200);
  await klickText(".tab", "Erledigt"); await warte(150);
  pruefe("Handy: Tab „Erledigt“ zeigt erledigte Karten", await ev("document.querySelectorAll('.spalte:not(.aus) .karte.zu').length >= 2"));
  await geh("file:///" + path.join(WURZEL, VERSION, "handy.html").replace(/\\/g, "/"));
  await foto("handy_vpn_seite");

  // ---------------- Auswertung Konsole, CSP, Netz
  const fehler = ereignisse.filter(e => (e.method === "Runtime.exceptionThrown") || (e.method === "Log.entryAdded" && e.params.entry.level === "error")
    || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error"));
  pruefe("Keine Konsolenfehler und keine CSP-Verstöße", !fehler.length, JSON.stringify(fehler.map(e => e.params.entry ? e.params.entry.text : e.params.exceptionDetails ? e.params.exceptionDetails.text : e.params.args)).slice(0, 600));
  const fremd = ereignisse.filter(e => e.method === "Network.requestWillBeSent").map(e => e.params.request.url)
    .filter(u => !u.startsWith("file:") && !u.startsWith("data:") && !u.startsWith("blob:") && !u.startsWith("about:") && !u.startsWith(dienstUrl));
  pruefe("Keine Netzanfragen außer Datei und eigenem Dienst", !fremd.length, fremd.join(", "));

  await cdp("Browser.close").catch(() => {});
  dienst.kill();
  await warte(500);
  try { fs.rmSync(TMP, {recursive: true, force: true}); } catch (e) { /* Profil evtl. noch gesperrt */ }
  const schlecht = ergebnisse.filter(e => !e[1]);
  console.log("\n" + (schlecht.length ? schlecht.length + " FEHLER" : "ALLES OK") + " (" + ergebnisse.length + " Prüfungen), Bilder in " + BILDER);
  process.exit(schlecht.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
