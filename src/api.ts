/**
 * The live service (live.mispriced.fi) as the extension uses it: which market a venue page shows,
 * each venue's books as they change, and which venues word the rules the same way. The extension
 * only reads public market data; it sends the venue page link and nothing about the reader.
 */
import type { VenueLink as IndexVenue } from "@/lib/venuePage";
import type { VenueBooks } from "@/components/market/model";

export const LIVE = "https://live.mispriced.fi";

export type Market = { title: string; href: string; category: string; endTs: number | null; venues: IndexVenue[]; open: boolean; series: boolean };
export type Resolved =
  | { kind: "market"; market: Market; here: { venue: string; sub?: string }; ext: string; latest?: string; notice?: unknown }
  | { kind: "none"; here: { venue: string; sub?: string; link: IndexVenue }; ext: string; latest?: string; notice?: unknown };

export async function resolve(url: string, signal?: AbortSignal): Promise<Resolved> {
  const r = await fetch(`${LIVE}/resolve?url=${encodeURIComponent(url)}`, { signal });
  if (r.status !== 200 && r.status !== 404) throw new Error(`resolve ${r.status}`);
  const j = await r.json();
  const v = { ext: j.ext, ...(typeof j.latest === "string" ? { latest: j.latest } : {}), notice: j.notice };
  return r.status === 200 ? { kind: "market", market: j.market, here: j.here, ...v } : { kind: "none", here: j.here, ...v };
}

const bookUrl = (v: IndexVenue) => `${LIVE}/book?venue=${v.venue}&url=${encodeURIComponent(v.url)}` + (v.ref ? `&ref=${encodeURIComponent(v.ref)}` : "");

/** How long to wait before asking again after the service refused a stream (busy, or too many). */
const RETRY_MS = 30_000;

/**
 * A venue's books as they change. Returns the close function. A dropped connection reconnects by
 * itself; a refused one (the service is busy) is asked again after RETRY_MS.
 */
export function streamBooks(v: IndexVenue, on: (books: VenueBooks | null, at: number) => void, onError: () => void): () => void {
  let es: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const open = () => {
    retry = null;
    if (closed) return;
    es = new EventSource(bookUrl(v));
    es.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data) as { at: number; books?: VenueBooks };
        on(m.books ?? null, m.at || Date.now());
      } catch {
        /* a malformed frame: the next one replaces it */
      }
    };
    es.onerror = () => {
      onError();
      if (!closed && es?.readyState === EventSource.CLOSED && !retry) retry = setTimeout(open, RETRY_MS);
    };
  };
  open();
  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    es?.close();
  };
}

/**
 * A venue's books once, read from the same stream (the service worker has no EventSource): the
 * first frame, or null after `ms`.
 */
export async function booksOnce(v: IndexVenue, ms = 6000): Promise<VenueBooks | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(bookUrl(v), { signal: ac.signal });
    if (!r.ok || !r.body) return null;
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      buf += dec.decode(value, { stream: true });
      for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
        const data = buf.slice(0, i).split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
        buf = buf.slice(i + 2);
        if (data) return (JSON.parse(data) as { books?: VenueBooks }).books ?? null;
      }
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}

/** Which venue pairs word an outcome's rules alike (`all`: every pair, as on sports). */
export type RulesOk = { all: boolean; ok: Record<string, string[]> };
export async function rulesOk(href: string): Promise<RulesOk | null> {
  try {
    const r = await fetch(`${LIVE}/arbok?href=${encodeURIComponent(href)}`);
    const j = r.ok ? await r.json() : null;
    return j && typeof j.all === "boolean" ? { all: j.all, ok: j.ok ?? {} } : null;
  } catch {
    return null;
  }
}

/** "0.2.1" < "0.10.0": the extension is older than the service needs. */
export function olderThan(v: string, min: string): boolean {
  const a = v.split(".").map(Number), b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  return false;
}
