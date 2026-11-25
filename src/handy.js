"use strict";
(() => {
  const knopf = document.getElementById("kopieren"), pre = document.getElementById("prompt");
  knopf.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(pre.textContent); knopf.textContent = "Kopiert"; }
    catch (e) {
      const r = document.createRange(); r.selectNodeContents(pre);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      knopf.textContent = "Markiert: jetzt Strg+C";
    }
    setTimeout(() => { knopf.textContent = "Prompt kopieren"; }, 2500);
  });
})();
