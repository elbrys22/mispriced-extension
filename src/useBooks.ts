import { useEffect, useMemo, useState } from "react";
import type { VenueState } from "@/components/market/model";
import type { VenueLink as IndexVenue } from "@/lib/venuePage";
import { streamBooks } from "./api";

/** Prices older than this read as stale: the panel dims them and drops the verdict. */
export const STALE_MS = 30_000;
/** A venue with no books this long after its stream opened shows as unavailable until they come. */
export const FIRST_MS = 15_000;

/**
 * Each venue's books, streamed from the live service as they change. Streams close while the
 * panel is hidden and reopen when it shows again.
 */
export function useBooks(venues: IndexVenue[]) {
  const [state, setState] = useState<Record<string, VenueState>>({});
  const [visible, setVisible] = useState(!document.hidden);
  const key = JSON.stringify(venues);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  // A new market: forget the last one's books.
  useEffect(() => {
    const now = Date.now();
    setState(Object.fromEntries(venues.map((v) => [v.venue, { books: null, at: null, since: now, failed: false, ms: null }])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!visible) return;
    const closers = venues.map((v) =>
      streamBooks(
        v,
        (books, at) =>
          setState((s) => {
            const prev = s[v.venue];
            const since = prev?.since ?? Date.now();
            return { ...s, [v.venue]: { books: books ?? prev?.books ?? null, at, since, failed: false, ms: prev?.ms ?? Date.now() - since } };
          }),
        () => setState((s) => (s[v.venue] ? { ...s, [v.venue]: { ...s[v.venue], failed: true } } : s)),
      ),
    );
    const slow = setTimeout(
      () => setState((s) => Object.fromEntries(Object.entries(s).map(([v, st]) => [v, st.books || st.failed ? st : { ...st, failed: true }]))),
      FIRST_MS,
    );
    return () => {
      clearTimeout(slow);
      closers.forEach((c) => c());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, visible]);
  const lastAt = useMemo(() => Object.values(state).reduce<number | null>((m, s) => (s.at != null && (m == null || s.at > m) ? s.at : m), null), [state]);
  const failed = Object.values(state).length > 0 && Object.values(state).every((s) => s.failed);
  return { state, lastAt, failed };
}
