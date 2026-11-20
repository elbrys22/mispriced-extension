import { useEffect, useState } from "react";

export type TabInfo = { id: number; windowId: number; url: string | null; title: string };

/**
 * The tab the panel sits next to: the active tab of the panel's window, followed as the reader
 * switches tabs or the page navigates (venue sites change pages without reloading). Chrome only
 * reveals the link of the six venue sites, so every other page reads as "not a market page".
 * `?tab=<id>` pins one tab (opening the panel as a page, for testing).
 */
export function useActiveTab(): TabInfo | null {
  const [tab, setTab] = useState<TabInfo | null>(null);
  useEffect(() => {
    const pinned = Number(new URLSearchParams(location.search).get("tab")) || null;
    let windowId: number | null = null;
    const put = (t: chrome.tabs.Tab | undefined) =>
      t?.id != null && setTab({ id: t.id, windowId: t.windowId, url: t.url ?? null, title: t.title ?? "" });
    const refresh = async () => {
      if (pinned) return put(await chrome.tabs.get(pinned).catch(() => undefined));
      windowId ??= (await chrome.windows.getCurrent()).id ?? null;
      const [t] = await chrome.tabs.query({ active: true, windowId: windowId ?? undefined });
      put(t);
    };
    const onActivated = (i: { tabId: number; windowId: number }) => (pinned ? i.tabId === pinned : i.windowId === windowId) && void refresh();
    const onUpdated = (id: number, c: { url?: string; title?: string; status?: string }, t: chrome.tabs.Tab) => {
      if ((pinned ? id === pinned : t.active && t.windowId === windowId) && (c.url || c.title || c.status === "complete")) put(t);
    };
    void refresh();
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  return tab;
}
