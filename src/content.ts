/**
 * Runs on the venue pages whose links don't change when the reader picks an outcome (Polymarket,
 * Limitless, Opinion, predict.fun): on each click, the text of the clicked element and the
 * elements around it goes to the extension, which matches it against the venue's outcome names
 * to follow the pick. Nothing is read until a click, nothing leaves the browser, and the page's
 * own layout is never relied on (its markup changes with every release).
 */
const MAX_TEXT = 400;
const DEPTH = 12;

addEventListener(
  "click",
  (e) => {
    const texts: string[] = [];
    for (let n = e.target instanceof Element ? e.target : null, i = 0; n && i < DEPTH; n = n.parentElement, i++) {
      const t = ((n as HTMLElement).innerText ?? n.textContent ?? "").replace(/\s+/g, " ").trim();
      // Past a row-sized block (the whole list, the rules) the text can't tell outcomes apart.
      if (t.length > MAX_TEXT) break;
      if (t && t !== texts[texts.length - 1]) texts.push(t);
    }
    if (!texts.length) return;
    // After the extension reloads, this page's copy of the script is cut off until a page reload.
    try {
      void chrome.runtime.sendMessage({ type: "pick", url: location.href, texts }).catch(() => {});
    } catch {
      /* extension context gone */
    }
  },
  { capture: true, passive: true },
);
