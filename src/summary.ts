/**
 * What the toolbar badge last worked out for a tab, kept for the popup's "On this page" block
 * (chrome.storage.session: cleared when the browser closes).
 */
export type Summary =
  | { kind: "page"; title: string; here: string; best: string | null; gap: number | null }
  | { kind: "only"; title: string; here: string }
  | { kind: "ended"; title: string; here: string };

const key = (tabId: number) => `tab:${tabId}`;

export const putSummary = (tabId: number, s: Summary | null) =>
  s ? chrome.storage.session.set({ [key(tabId)]: s }) : chrome.storage.session.remove(key(tabId));

export async function getSummary(tabId: number): Promise<Summary | null> {
  const r = await chrome.storage.session.get(key(tabId));
  return (r[key(tabId)] as Summary | undefined) ?? null;
}
