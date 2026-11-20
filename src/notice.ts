/**
 * A message for every reader, set by hand on our server (announcements, outages) and sent with each
 * page lookup (`notice` in /resolve, server/live/markets.ts). The panel shows it under its header and
 * the popup at its top; a reader can close it, and a closed message stays closed on this device until
 * a new one (another id) arrives.
 *
 * The server is trusted only so far: the text is shown as plain text, cut to 160 characters, and a
 * link opens only if it goes to mispriced.fi, our X account or our GitHub releases. Anything else is
 * dropped, so a message can never send readers somewhere we don't control.
 */
import { useEffect, useState } from "react";

export type Notice = { id: string; kind: "info" | "warning"; text: string; link?: string; label?: string };

const LINK = /^https:\/\/(mispriced\.fi|x\.com\/asymmetric_odds|github\.com\/elbrys22\/mispriced-extension)(\/[^\s]*)?$/;
const NEWS = "notice";
const CLOSED = "noticeClosed";

/** The server's notice, checked again here; null when absent or malformed. */
export function cleanNotice(raw: unknown): Notice | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as Record<string, unknown>;
  const text = typeof j.text === "string" ? j.text.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  const id = typeof j.id === "string" ? j.id.slice(0, 40) : "";
  if (!text || !id) return null;
  const link = typeof j.link === "string" && LINK.test(j.link) ? j.link : undefined;
  const label = link && typeof j.label === "string" && j.label.trim() ? j.label.trim().slice(0, 24) : undefined;
  return { id, kind: j.kind === "warning" ? "warning" : "info", text, ...(link ? { link } : {}), ...(label ? { label } : {}) };
}

/** Keep the latest lookup's notice (or its absence) for the panel and the popup. */
export function saveNotice(raw: unknown): void {
  const n = cleanNotice(raw);
  void chrome.storage.local.get(NEWS).then((r) => {
    if (JSON.stringify(r[NEWS] ?? null) !== JSON.stringify(n)) void chrome.storage.local.set({ [NEWS]: n });
  });
}

/** The notice to show now (null when there is none or the reader closed it), and how to close it. */
export function useNotice(): { notice: Notice | null; close: () => void } {
  const [news, setNews] = useState<Notice | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  useEffect(() => {
    void chrome.storage.local.get([NEWS, CLOSED]).then((r) => {
      setNews(cleanNotice(r[NEWS]));
      setClosed(typeof r[CLOSED] === "string" ? r[CLOSED] : null);
    });
    const on = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      if (NEWS in c) setNews(cleanNotice(c[NEWS].newValue));
      if (CLOSED in c) setClosed(typeof c[CLOSED].newValue === "string" ? c[CLOSED].newValue : null);
    };
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
  }, []);
  const notice = news && news.id !== closed ? news : null;
  return { notice, close: () => notice && void chrome.storage.local.set({ [CLOSED]: notice.id }) };
}
