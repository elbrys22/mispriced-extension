/**
 * Whether the reader allowed the extension to send venue page links to our server (design 24g).
 * The Chrome Web Store's user-data policy asks for this inside the extension, before anything is
 * sent: until then there's no lookup, no prices and no badge. Kept on this device only.
 */
const KEY = "consent";
/** Bumped when the extension starts sending something new, so the reader is asked again. */
export const CONSENT_VERSION = 2;
type Consent = { v: number; at: number };

const ok = (c: unknown) => ((c as Consent | undefined)?.v ?? 0) >= CONSENT_VERSION;

export async function hasConsent(): Promise<boolean> {
  return ok((await chrome.storage.local.get(KEY))[KEY]);
}

export const giveConsent = () => chrome.storage.local.set({ [KEY]: { v: CONSENT_VERSION, at: Date.now() } satisfies Consent });

export function onConsent(cb: (allowed: boolean) => void): () => void {
  const on = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && KEY in c) cb(ok(c[KEY].newValue));
  };
  chrome.storage.onChanged.addListener(on);
  return () => chrome.storage.onChanged.removeListener(on);
}
