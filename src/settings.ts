/** The reader's choices from the popup (design 24f), kept in Chrome's synced storage. */
export type Settings = {
  /** The amount the panel and the badge compare at, in dollars. */
  amount: number;
  badge: boolean;
  /** Keep the panel open when the reader switches tabs. */
  keepOpen: boolean;
  /** Venues left out of the comparison. */
  off: string[];
};

export const DEFAULTS: Settings = { amount: 500, badge: true, keepOpen: true, off: [] };
export const MAX_AMOUNT = 100_000_000;

export async function getSettings(): Promise<Settings> {
  const s = (await chrome.storage.sync.get(DEFAULTS)) as Settings;
  return { ...DEFAULTS, ...s };
}

export const setSettings = (p: Partial<Settings>) => chrome.storage.sync.set(p);

export function onSettings(fn: (s: Settings) => void): () => void {
  const l = (_c: unknown, area: string) => area === "sync" && void getSettings().then(fn);
  chrome.storage.onChanged.addListener(l);
  return () => chrome.storage.onChanged.removeListener(l);
}
