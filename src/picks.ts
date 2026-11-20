/**
 * The last outcome click on a tab's venue page (from the content script), kept by the service
 * worker so a panel opened after the click still follows it (chrome.storage.session: the
 * content script can't write there itself).
 */
export type Pick = { url: string; texts: string[]; at: number };
export type PickMessage = { type: "pick"; url: string; texts: string[] };

const key = (tabId: number) => `pick:${tabId}`;

export const isPick = (m: unknown): m is PickMessage =>
  !!m && typeof m === "object" && (m as PickMessage).type === "pick" && Array.isArray((m as PickMessage).texts) && typeof (m as PickMessage).url === "string";

export const putPick = (tabId: number, p: Pick | null) => (p ? chrome.storage.session.set({ [key(tabId)]: p }) : chrome.storage.session.remove(key(tabId)));

export async function getPick(tabId: number): Promise<Pick | null> {
  const r = await chrome.storage.session.get(key(tabId));
  return (r[key(tabId)] as Pick | undefined) ?? null;
}

/** The same page, whatever its query or hash says. */
export const samePage = (a: string, b: string) => a.split(/[?#]/)[0].replace(/\/$/, "") === b.split(/[?#]/)[0].replace(/\/$/, "");
