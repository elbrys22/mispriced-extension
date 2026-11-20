/**
 * The market terminal's model (design 19a/20a): venue books merged into outcomes, the
 * volume-weighted consensus, cross-venue arbitrage and the routed fills. Pure functions only —
 * the components and hooks build on these.
 */
import { crossFill, effSell, flip, mergeBooks,type Book, type Fee, type Level, type MergedBook } from "@/lib/bookMath";
import { alignGameBinary, gameOutcomeLabel, gameSides, isMatchWinner, isOtherOutcome, kalshiAliases, outcomeKey, outcomeKeyIn, shownLabel, sideMarketTag } from "@/lib/outcomeKey";

export type OutcomeBook = {
  outcome: string;
  vol?: number;
  book: Book;
  resolved?: "yes" | "no";
  chg24?: number;
  sides?: [string, string];
  order?: number;
  fee?: Fee;
  /** The venue's own id for the outcome (a Kalshi market ticker). */
  id?: string;
};
export type VenueBooks = { venue: string; available: boolean; outcomes: OutcomeBook[]; category?: string; title?: string };
/** `target`: an up/down window's price to beat on that venue. */
export type VenueLink = { venue: string; url: string; ref?: string; target?: number };
/** One venue's connection: its last books, when they came, and how long the first answer took. */
export type VenueState = { books: VenueBooks | null; at: number | null; since: number; failed: boolean; ms: number | null };
export type VenueStatus = "live" | "connecting" | "timeout";

export type Outcome = {
  key: string;
  label: string;
  resolved?: "yes" | "no";
  /** YES books by venue (open outcomes only). */
  books: Record<string, Book>;
  /** Each venue's own key for the outcome (its history is asked for by that). */
  vkeys: Record<string, string>;
  /** Each venue's own label (trades and rules come back under it). */
  vlabels: Record<string, string>;
  fees: Record<string, Fee | undefined>;
  /** Lifetime volume by venue, USD, where the venue reports it. */
  vols: Record<string, number>;
  /** Venues whose YES is this outcome's NO (a game listed with the teams the other way round): their history is read flipped. */
  flipped: Record<string, boolean>;
  vol: number;
  chg24: number | null;
  sides?: [string, string];
  order?: number;
  /** Best YES / NO asks and bids across venues (0–1). */
  yesAsk: number | null;
  yesBid: number | null;
  noAsk: number | null;
  noBid: number | null;
  cons: Consensus;
};

export type Consensus = {
  /** Volume-weighted YES probability, 0–1. */
  p: number | null;
  /** Each venue's mid (0–1) where it has a usable two-sided book. */
  mids: Record<string, number>;
  /** Each venue's share of the reported volume (0–1); absent where the venue reports none. */
  share: Record<string, number>;
};

export const SLOW_MS = 8000;
/** Venue colours on the chart, legend, route bar (design 20a). */
export const VENUE_COLOR: Record<string, string> = {
  poly: "#7f97ff",
  kalshi: "#5ec4a6",
  limitless: "#cfdf7a",
  opinion: "#e39a6e",
  predictfun: "#a896ef",
  hyperliquid: "#97fce4",
  xo: "#ff87a6",
};
export const venueColor = (v: string) => VENUE_COLOR[v] ?? "#8fb3e0";

export function venueStatus(st: VenueState | undefined, now: number): VenueStatus {
  if (st?.at != null) return "live";
  return st && (st.failed || now - st.since > SLOW_MS) ? "timeout" : "connecting";
}

const mid = (b: Book): number | null => (b.bestBid != null && b.bestAsk != null ? (b.bestBid + b.bestAsk) / 2 : null);

/**
 * Consensus: the volume-weighted mean of the venues' mids (design 20a). A venue that reports no
 * volume counts as an average venue; a book wider than 20¢ says nothing about the price and is
 * left out while a tighter one exists.
 */
export function consensusOf(books: Record<string, Book>, vols: Record<string, number>): Consensus {
  const mids: Record<string, number> = {};
  const tight: string[] = [];
  for (const [v, b] of Object.entries(books)) {
    const m = mid(b);
    if (m == null) continue;
    mids[v] = m;
    if ((b.spread ?? 1) <= 0.2) tight.push(v);
  }
  const use = tight.length ? tight : Object.keys(mids);
  const reported = use.filter((v) => (vols[v] ?? 0) > 0);
  const avgVol = reported.length ? reported.reduce((t, v) => t + vols[v], 0) / reported.length : 1;
  const w = (v: string) => ((vols[v] ?? 0) > 0 ? vols[v] : avgVol);
  const W = use.reduce((t, v) => t + w(v), 0);
  const p = use.length && W > 0 ? use.reduce((t, v) => t + mids[v] * w(v), 0) / W : null;
  const totalVol = Object.keys(books).reduce((t, v) => t + (vols[v] ?? 0), 0);
  const share: Record<string, number> = {};
  if (totalVol > 0) for (const v of Object.keys(books)) if ((vols[v] ?? 0) > 0) share[v] = vols[v] / totalVol;
  return { p, mids, share };
}

/** Weights the chart's consensus line uses (same rule as consensusOf, on the current volumes). */
export function consensusWeights(venues: string[], vols: Record<string, number>): Record<string, number> {
  const reported = venues.filter((v) => (vols[v] ?? 0) > 0);
  const avg = reported.length ? reported.reduce((t, v) => t + vols[v], 0) / reported.length : 1;
  return Object.fromEntries(venues.map((v) => [v, (vols[v] ?? 0) > 0 ? vols[v] : avg]));
}

/** Every venue's outcomes merged by key: open ones first in venue order, then resolved. */
export function buildOutcomes(venues: VenueLink[], state: Record<string, VenueState>, title: string) {
  const byKey = new Map<string, Outcome>();
  const list: Outcome[] = [];
  // A game's page ("A vs B", not one of its side markets): its two teams in title order.
  const matchup = sideMarketTag(title) ? null : gameSides(title);
  // Kalshi's own names for outcomes other venues name differently ("Pittsburgh", "Grace Meng" for "Grace Meng (D)"): filed under theirs, as on the cards.
  const alias = kalshiAliases(
    venues.flatMap((v) => (state[v.venue]?.books?.outcomes ?? []).map((o) => ({ venue: v.venue, label: o.outcome, id: o.id }))),
    title,
  ).map;
  const aliasLabel = new Set<string>();
  for (const v of venues) {
    for (const raw of state[v.venue]?.books?.outcomes ?? []) {
      // A game listed as one binary: its YES lined up with the title's first team.
      const { ob, flipped } = alignGameBinary(raw, title);
      const label = gameOutcomeLabel(ob.outcome, title, ob.sides);
      const aliased = v.venue === "kalshi" && ob.id ? alias.get(ob.id) : undefined;
      const key = aliased ?? outcomeKeyIn(label, title);
      let o = byKey.get(key);
      // The outcome goes by the other venues' name, not Kalshi's short one.
      if (o && !aliased && aliasLabel.delete(key)) o.label = shownLabel(label, key, title);
      if (!o) {
        if (aliased) aliasLabel.add(key);
        o = {
          key,
          label: shownLabel(label, key, title),
          books: {},
          vkeys: {},
          vlabels: {},
          fees: {},
          vols: {},
          flipped: {},
          vol: 0,
          chg24: null,
          yesAsk: null,
          yesBid: null,
          noAsk: null,
          noBid: null,
          cons: { p: null, mids: {}, share: {} },
        };
        byKey.set(key, o);
        list.push(o);
      }
      if (ob.resolved && !o.resolved) o.resolved = ob.resolved;
      if (ob.sides && !o.sides) o.sides = ob.sides;
      if (ob.order != null) o.order = Math.min(o.order ?? ob.order, ob.order);
      o.vkeys[v.venue] ??= outcomeKey(ob.outcome);
      if (flipped) o.flipped[v.venue] = true;
      o.vlabels[v.venue] ??= ob.outcome;
      if (!ob.resolved) {
        o.books[v.venue] = ob.book;
        o.fees[v.venue] = ob.fee;
      }
      if (ob.vol) {
        o.vols[v.venue] = (o.vols[v.venue] ?? 0) + ob.vol;
        o.vol += ob.vol;
      }
      if (o.chg24 == null && ob.chg24 != null) o.chg24 = ob.chg24;
    }
  }
  // One venue's books on the nameless row move onto a named one (flipped: its YES is that row's NO).
  const moveTo = (orphan: Outcome, to: Outcome, v: string, flipIt: boolean) => {
    to.books[v] = flipIt ? flip(orphan.books[v]) : orphan.books[v];
    to.fees[v] = orphan.fees[v];
    to.vkeys[v] = orphan.vkeys[v];
    to.vlabels[v] = orphan.vlabels[v];
    if (flipIt) to.flipped[v] = true;
    if (orphan.vols[v]) {
      to.vols[v] = (to.vols[v] ?? 0) + orphan.vols[v];
      to.vol += orphan.vols[v];
    }
    delete orphan.books[v];
    delete orphan.vkeys[v];
    delete orphan.vlabels[v];
    orphan.vol -= orphan.vols[v] ?? 0;
    delete orphan.vols[v];
  };
  // A venue that lists a game as a nameless binary with no team names can't be placed by label.
  // It joins the match winner only when its price says which way round it is — within 8¢ of the
  // matchup's price one way and 12¢+ off the other — and otherwise stays its own row.
  const winner = list.find((o) => isMatchWinner(o.key) && !o.resolved);
  const orphan = list.find((o) => o.key === "" && !o.resolved);
  if (matchup && winner && orphan) {
    const wm = Object.values(winner.books).map(mid).filter((m): m is number => m != null);
    const p = wm.length ? wm.reduce((t, m) => t + m, 0) / wm.length : null;
    for (const v of Object.keys(orphan.books)) {
      const m = mid(orphan.books[v]);
      if (p == null || m == null || winner.books[v]) continue;
      const same = Math.abs(m - p), other = Math.abs(1 - m - p);
      const asIs = same <= 0.08 && other >= 0.12, flipIt = other <= 0.08 && same >= 0.12;
      if (asIs || flipIt) moveTo(orphan, winner, v, flipIt);
    }
  }
  // A venue that lists one outcome of a multi-outcome market as its own Yes/No question ("Will
  // STRC hit $100 by December 31?" beside Polymarket's dates) joins the outcome its question names,
  // the longest name it contains.
  if (!matchup && orphan && list.length > 2) {
    const norm = (x: string) => ` ${x.toLowerCase().replace(/[^a-z0-9.%$]+/g, " ").trim()} `;
    for (const v of Object.keys(orphan.books)) {
      const q = state[v]?.books?.title;
      if (!q) continue;
      const to = list
        .filter((o) => o !== orphan && !o.resolved && !o.books[v] && o.label.length >= 3 && norm(q).includes(norm(o.label)))
        .sort((a, b) => b.label.length - a.label.length)[0];
      if (to) moveTo(orphan, to, v, false);
    }
  }
  if (orphan && !Object.keys(orphan.books).length) list.splice(list.indexOf(orphan), 1);
  for (const o of list) {
    const bs = Object.values(o.books);
    const bid = bs.reduce<number | null>((m, b) => (b.bestBid != null && (m == null || b.bestBid > m) ? b.bestBid : m), null);
    const ask = bs.reduce<number | null>((m, b) => (b.bestAsk != null && (m == null || b.bestAsk < m) ? b.bestAsk : m), null);
    o.yesAsk = ask;
    o.yesBid = bid;
    o.noAsk = bid != null ? Math.round((1 - bid) * 1e4) / 1e4 : null;
    o.noBid = ask != null ? Math.round((1 - ask) * 1e4) / 1e4 : null;
    o.cons = consensusOf(o.books, o.vols);
    if (o.cons.p == null) o.cons.p = bid != null && ask != null ? (bid + ask) / 2 : (bid ?? ask);
  }
  // A game's page is about who wins: a side market only one venue lists (a map's winner, O/U
  // games, a handicap) can't be compared across venues, so it isn't listed beside the match.
  const game = / vs\.? /i.test(title) && !sideMarketTag(title);
  const sideOnly = (o: Outcome) => game && !!sideMarketTag(o.label) && Object.keys(o.books).length <= 1;
  const live = list
    .filter((o) => !o.resolved && !sideOnly(o))
    .sort(
      (a, b) =>
        Number(isOtherOutcome(a.label)) - Number(isOtherOutcome(b.label)) ||
        Number(isMatchWinner(b.key)) - Number(isMatchWinner(a.key)) ||
        (a.order ?? 1e9) - (b.order ?? 1e9) ||
        (b.cons.p ?? -1) - (a.cons.p ?? -1),
    );
  const settled = list.filter((o) => o.resolved && !sideOnly(o));
  return { live, settled, all: [...live, ...settled] };
}

/** "↑ $150K" reaches a level from below, "↓ $80K" from above (hit-price markets). */
export function dirOf(label: string): "up" | "down" | null {
  if (/^\s*(↑|▲)|\b(reach|hit|above|high)\b/i.test(label)) return "up";
  if (/^\s*(↓|▼)|\b(dip|below|low)\b/i.test(label)) return "down";
  return null;
}

/** The level an outcome names, for sorting a ladder ("↑ $150K" → 150000). */
export function levelOf(label: string): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*([kKmMbB])?/.exec(label);
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, "")) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? "").toLowerCase() as "k" | "m" | "b"] ?? 1);
  return Number.isFinite(v) ? v : null;
}

/* -------------------------------- arbitrage -------------------------------- */
export type Arb = {
  key: string;
  label: string;
  /** Buy YES at this venue's ask… */
  yes: { venue: string; price: number };
  /** …and NO at this one (its YES bid, flipped). */
  no: { venue: string; price: number };
  /** Bid on B − ask on A, at the touch. */
  edge: number;
  /** YES + NO at the touch (< $1). */
  sum: number;
  shares: number;
  /** After both venues' fees. */
  profit: number;
  /** Everything both legs cost, fees included. */
  capital: number;
  fees: number;
  /** Why the two venues may not resolve alike (null: same rules, reviewed, or sports). */
  doubt: ArbDoubt | null;
};
/**
 * From the live service (server/shared/arbRules): rules not shown alike, deadlines apart (UTC days,
 * YES venue's first), or a game postponed or cancelled.
 */
export type ArbDoubt = { why: "rules" } | { why: "deadline"; dates: [number, number] } | { why: "schedule" };

/**
 * The best crossed pair on an outcome: buy YES where it's cheapest, buy NO on the venue whose
 * YES bid is above that ask. Max size walks both books level by level while the pair still pays
 * after both venues' fees (lib/bookMath crossFill, as on the main page). Ignored: edges over 15¢,
 * touches outside 3–97¢ (a stale or broken book, not a trade) and pairs one dust order deep. A
 * pair whose venues may not resolve alike (`doubtOf`) still shows, with its doubt, but one that
 * checks out is preferred over it.
 */
export function arbOf(o: Outcome, fresh: (venue: string) => boolean, doubtOf: (key: string, yes: string, no: string) => ArbDoubt | null): Arb | null {
  let best: Arb | null = null;
  const vs = Object.keys(o.books).filter(fresh);
  for (const a of vs) {
    const A = o.books[a];
    if (A.bestAsk == null) continue;
    for (const b of vs) {
      if (a === b) continue;
      const B = o.books[b];
      if (B.bestBid == null || B.bestBid - A.bestAsk <= 1e-9) continue;
      const edge = B.bestBid - A.bestAsk;
      if (edge > 0.15 || A.bestAsk < 0.03 || B.bestBid > 0.97) continue;
      const asks = [...A.asks].sort((x, y) => x.price - y.price);
      const bids = [...B.bids].sort((x, y) => y.price - x.price);
      const { shares, cost: capital, fees } = crossFill(asks, bids, o.fees[a], o.fees[b]);
      const profit = shares - capital;
      if (capital < 5 || profit < 0.05) continue;
      const cand: Arb = {
        key: o.key,
        label: o.label,
        yes: { venue: a, price: A.bestAsk },
        no: { venue: b, price: Math.round((1 - B.bestBid) * 1e4) / 1e4 },
        edge,
        sum: A.bestAsk + 1 - B.bestBid,
        shares,
        profit,
        capital,
        fees,
        doubt: doubtOf(o.key, a, b),
      };
      if (!best || (!cand.doubt && best.doubt) || (!cand.doubt === !best.doubt && cand.profit > best.profit)) best = cand;
    }
  }
  return best;
}

/* ------------------------------- side books ------------------------------- */
/** A venue's book on the chosen side (NO books are YES books flipped). */
export const sideBook = (b: Book | undefined, side: "yes" | "no"): Book | null => (b ? (side === "yes" ? b : flip(b)) : null);

export function combined(o: Outcome | null, side: "yes" | "no"): MergedBook {
  return mergeBooks(Object.entries(o?.books ?? {}).map(([venue, b]) => ({ venue, book: sideBook(b, side) })));
}

/** USD resting within `c` of the touch on each side of a merged book. */
export function depthWithin(m: MergedBook, c: number): { bids: number; asks: number } {
  const bids = m.bestBid == null ? 0 : m.bids.filter((l) => l.price >= m.bestBid! - c - 1e-9).reduce((t, l) => t + l.price * l.size, 0);
  const asks = m.bestAsk == null ? 0 : m.asks.filter((l) => l.price <= m.bestAsk! + c + 1e-9).reduce((t, l) => t + l.price * l.size, 0);
  return { bids, asks };
}

/* ---------------------------------- sell ---------------------------------- */
export type SellFill = {
  /** Net per share after fees. */
  avg: number | null;
  /** Before fees, per share. */
  avgPx: number | null;
  proceeds: number;
  fees: number;
  shares: number;
  full: boolean;
  byVenue: { venue: string; shares: number; usd: number }[];
};

/** Sell `shares` into one or more venues' bids, best net-of-fee price first. */
export function sellAfterFees(books: { venue: string; bids: Level[]; fee?: Fee }[], shares: number): SellFill {
  const levels = books
    .flatMap((b) => b.bids.filter((l) => l.size > 0 && l.price > 0 && l.price < 1).map((l) => ({ venue: b.venue, price: l.price, size: l.size, net: effSell(b.fee, l.price) })))
    .sort((a, b) => b.net - a.net);
  let left = shares, gross = 0, net = 0;
  const by = new Map<string, { venue: string; shares: number; usd: number }>();
  for (const l of levels) {
    if (left <= 1e-9) break;
    const take = Math.min(left, l.size);
    gross += take * l.price;
    net += take * l.net;
    const e = by.get(l.venue) ?? { venue: l.venue, shares: 0, usd: 0 };
    e.shares += take;
    e.usd += take * l.net;
    by.set(l.venue, e);
    left -= take;
  }
  const sold = shares - Math.max(0, left);
  return {
    avg: sold > 0 ? net / sold : null,
    avgPx: sold > 0 ? gross / sold : null,
    proceeds: net,
    fees: gross - net,
    shares: sold,
    full: left <= 1e-9,
    byVenue: [...by.values()].filter((v) => v.shares > 0.01).sort((a, b) => b.usd - a.usd),
  };
}
