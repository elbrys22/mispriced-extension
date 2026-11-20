/** Order-book arithmetic and price formatting shared by the market page layouts. */

export type Level = { price: number; size: number };
export type Book = {
  bids: Level[];
  asks: Level[];
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
};

/** Whole cents, or one decimal when the venue quotes sub-cent ticks (e.g. predict.fun 16.9¢). */
export const cents = (p: number | null | undefined) => {
  if (p == null) return "—";
  const c = p * 100;
  return Math.abs(c - Math.round(c)) < 0.05 ? `${Math.round(c)}¢` : `${c.toFixed(1)}¢`;
};
/** Always one decimal ("45.0¢", "53.5¢"): price buttons in a list line up, and sub-cent quotes show. */
export const cents1 = (p: number | null | undefined) => (p == null ? "—" : `${(p * 100).toFixed(1)}¢`);
export const spreadStr = (s: number | null | undefined) =>
  s == null ? "—" : `${(s * 100).toFixed(s * 100 < 1 ? 1 : 0)}¢`;
export function compact(nv: number): string {
  if (!Number.isFinite(nv) || nv <= 0) return "—";
  if (nv >= 1e6) return `${(nv / 1e6).toFixed(1)}M`;
  if (nv >= 1e3) return `${(nv / 1e3).toFixed(1)}k`;
  return `${Math.round(nv)}`;
}
export function usd(nv: number): string {
  if (!Number.isFinite(nv) || nv <= 0) return "—";
  if (nv >= 1e6) return `$${(nv / 1e6).toFixed(1)}M`;
  if (nv >= 1e3) return `$${(nv / 1e3).toFixed(1)}k`;
  return `$${Math.round(nv)}`;
}

/** Liquidity within 2¢ of the touch, both sides, as USD notional. */
export function depth2c(b: Book): number {
  let d = 0;
  if (b.bestBid != null) for (const l of b.bids) if (l.price >= b.bestBid - 0.02) d += l.size * l.price;
  if (b.bestAsk != null) for (const l of b.asks) if (l.price <= b.bestAsk + 0.02) d += l.size * l.price;
  return d;
}

/** Walk asks to buy `shares`; avg price + slippage vs best ask. */
export function fill(b: Book | null, shares: number): { avg: number | null; slip: number | null; filled: number } {
  if (!b || !b.asks.length) return { avg: null, slip: null, filled: 0 };
  let rem = shares,
    cost = 0,
    filled = 0;
  for (const l of b.asks) {
    const take = Math.min(rem, l.size);
    cost += take * l.price;
    filled += take;
    rem -= take;
    if (rem <= 0) break;
  }
  if (filled <= 0) return { avg: null, slip: null, filled: 0 };
  return { avg: cost / filled, slip: cost / filled - b.asks[0].price, filled };
}

/** Walk asks spending `dollars`; `full` is false when the book runs out first. */
export function fillUsd(
  b: Book | null,
  dollars: number,
): { avg: number | null; slip: number | null; shares: number; full: boolean } {
  if (!b || !b.asks.length) return { avg: null, slip: null, shares: 0, full: false };
  let left = dollars,
    cost = 0,
    shares = 0;
  for (const l of b.asks) {
    if (l.price <= 0) continue;
    const spend = Math.min(left, l.price * l.size);
    cost += spend;
    shares += spend / l.price;
    left -= spend;
    if (left <= 1e-6) break;
  }
  if (shares <= 0) return { avg: null, slip: null, shares: 0, full: false };
  const avg = cost / shares;
  return { avg, slip: avg - b.asks[0].price, shares, full: left <= 1e-6 };
}

/** The NO book of a YES book: NO bids are YES asks at 1 − p, and the other way round. */
export function flip(b: Book): Book {
  const bids = b.asks.map((l) => ({ price: Math.round((1 - l.price) * 1e4) / 1e4, size: l.size }));
  const asks = b.bids.map((l) => ({ price: Math.round((1 - l.price) * 1e4) / 1e4, size: l.size }));
  bids.sort((x, y) => y.price - x.price);
  asks.sort((x, y) => x.price - y.price);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  return { bids, asks, bestBid, bestAsk, spread: bestBid != null && bestAsk != null ? Math.max(0, bestAsk - bestBid) : null };
}

/* ------------------------------ combined book ------------------------------ */
export type MergedLevel = { price: number; size: number; venues: { venue: string; size: number }[] };
export type MergedBook = { bids: MergedLevel[]; asks: MergedLevel[]; bestBid: number | null; bestAsk: number | null };

/**
 * Every venue's levels on one ladder: levels at the same price (to 0.1¢ — Hyperliquid quotes
 * 39.995¢ against everyone else's 40¢) are summed, each keeping
 * which venues make it up. Asks low → high, bids high → low. A cross (one venue's bid above
 * another's ask) is left as it is — that's a real gap between venues, not an error.
 */
export function mergeBooks(books: { venue: string; book: Book | null }[]): MergedBook {
  const side = (pick: (b: Book) => Level[], dir: 1 | -1): MergedLevel[] => {
    const at = new Map<number, MergedLevel>();
    for (const { venue, book } of books) {
      if (!book) continue;
      for (const l of pick(book)) {
        if (!(l.size > 0) || !(l.price > 0) || l.price >= 1) continue;
        const p = Math.round(l.price * 1e3) / 1e3;
        const m = at.get(p) ?? { price: p, size: 0, venues: [] };
        m.size += l.size;
        const v = m.venues.find((x) => x.venue === venue);
        if (v) v.size += l.size;
        else m.venues.push({ venue, size: l.size });
        at.set(p, m);
      }
    }
    return [...at.values()].sort((a, b) => dir * (a.price - b.price));
  };
  const asks = side((b) => b.asks, 1);
  const bids = side((b) => b.bids, -1);
  return { asks, bids, bestAsk: asks[0]?.price ?? null, bestBid: bids[0]?.price ?? null };
}

/**
 * Spend `dollars` across the merged asks, cheapest first; a level several venues share is split
 * between them by size. Returns the average price, shares, and how much went to each venue.
 */
export function routeUsd(
  m: MergedBook,
  dollars: number,
): { avg: number | null; shares: number; full: boolean; byVenue: { venue: string; usd: number; shares: number }[] } {
  let left = dollars,
    cost = 0,
    shares = 0;
  const by = new Map<string, { venue: string; usd: number; shares: number }>();
  for (const l of m.asks) {
    const spend = Math.min(left, l.price * l.size);
    if (spend <= 0) break;
    for (const v of l.venues) {
      const part = (spend * v.size) / l.size;
      const e = by.get(v.venue) ?? { venue: v.venue, usd: 0, shares: 0 };
      e.usd += part;
      e.shares += part / l.price;
      by.set(v.venue, e);
    }
    cost += spend;
    shares += spend / l.price;
    left -= spend;
    if (left <= 1e-6) break;
  }
  return {
    avg: shares > 0 ? cost / shares : null,
    shares,
    full: left <= 1e-6,
    byVenue: [...by.values()].filter((v) => v.usd >= 0.5).sort((a, b) => b.usd - a.usd),
  };
}

/* ---------------------------------- fees ---------------------------------- */
/**
 * A venue's taker fee for buying on one market, from each venue's published schedule:
 *  - quad      Polymarket (rate × (p(1−p))^exp per share, rate per market), Kalshi (0.07 × series
 *              multiplier, rounded up to the cent per order), Opinion (topic rate ≤ 0.04 — not
 *              exposed, so the published maximum — with a $0.25 minimum per order).
 *  - minp      predict.fun: feeRateBps × min(p, 1−p) per share.
 *  - limitless Limitless, two schedules (lib/limitlessFees reads which one a market uses, and its
 *              rate, from Limitless's own fee estimate):
 *              legacy      taken in contracts, a curve published as a table (3% up to 50¢,
 *                          falling to 0.4% near $1), interpolated and scaled to the market's rate;
 *              collateral  taken from the stake: rate × (1 − p) of it (5% → 2.5% at 50¢).
 *              Without the estimate (no API key), the legacy table at 3%.
 *  - settle    Hyperliquid outcomes: nothing to open; the fee comes at settlement (spot taker
 *              base 0.07% of the payout).
 * Makers pay nothing anywhere, so resting orders aren't modelled.
 */
export type Fee =
  | { kind: "none" }
  /** The venue reported a fee structure we don't model yet: shown as unknown, never guessed. */
  | { kind: "unknown"; note: string }
  | { kind: "quad"; rate: number; exp?: number; min?: number; cent?: boolean; upTo?: boolean }
  | { kind: "minp"; rate: number }
  | { kind: "limitless"; mode?: "legacy" | "collateral"; bps?: number }
  | { kind: "settle"; rate: number };

const LIMITLESS_BUY: [number, number][] = [
  [0.5, 0.03], [0.55, 0.0252], [0.6, 0.0213], [0.65, 0.018], [0.7, 0.0151], [0.75, 0.0126], [0.8, 0.0105],
  [0.85, 0.0085], [0.9, 0.0068], [0.95, 0.0053], [0.99, 0.0042], [0.999, 0.004],
];
const limitlessBuyRate = (p: number) => (p <= 0.5 ? 0.03 : interp(LIMITLESS_BUY, p));
/** The share of a Limitless buy that goes to the fee at price p. */
const limitlessRate = (fee: Extract<Fee, { kind: "limitless" }>, p: number) =>
  fee.mode === "collateral" ? ((fee.bps ?? 500) / 1e4) * (1 - p) : limitlessBuyRate(p) * ((fee.bps ?? 300) / 300);

/** What one share that pays $1 really costs at price `p` after the venue's fee (min fee aside). */
export function effPrice(fee: Fee | undefined, p: number): number {
  if (!fee || fee.kind === "none" || fee.kind === "unknown") return p;
  if (fee.kind === "quad") return p + fee.rate * Math.pow(p * (1 - p), fee.exp ?? 1);
  if (fee.kind === "minp") return p + fee.rate * Math.min(p, 1 - p);
  if (fee.kind === "limitless") return p / (1 - limitlessRate(fee, p));
  return p / (1 - fee.rate); // settle
}

/** Per-order fee extras on top of the per-share fee: a minimum, or rounding up to the cent. */
function orderExtra(fee: Fee | undefined, feesUsd: number): number {
  if (fee?.kind !== "quad") return 0;
  let x = fee.min && feesUsd < fee.min ? fee.min - feesUsd : 0;
  if (fee.cent) x += Math.ceil((feesUsd + x) * 100 - 1e-9) / 100 - (feesUsd + x);
  return x;
}

/**
 * An arbitrage pair filled for real: YES up venue A's asks (cheapest first) and NO against venue
 * B's YES bids (highest first), level by level while a pair still pays after both venues' fees.
 * Each step takes the smaller side left. `cost` includes the fees; profit is `shares - cost`.
 */
export function crossFill(asks: Level[], bids: Level[], fa: Fee | undefined, fb: Fee | undefined): { shares: number; cost: number; fees: number } {
  const pair = (i: number, j: number) => effPrice(fa, asks[i].price) + effPrice(fb, 1 - bids[j].price);
  let i = 0, j = 0, ra = asks[0]?.size ?? 0, rb = bids[0]?.size ?? 0;
  let shares = 0, spend = 0, feeA = 0, feeB = 0;
  while (i < asks.length && j < bids.length && pair(i, j) < 0.999) {
    const q = Math.min(ra, rb);
    const pa = asks[i].price, pb = 1 - bids[j].price;
    shares += q;
    spend += q * (pa + pb);
    feeA += q * (effPrice(fa, pa) - pa);
    feeB += q * (effPrice(fb, pb) - pb);
    ra -= q;
    rb -= q;
    if (ra <= 1e-9 && ++i < asks.length) ra = asks[i].size;
    if (rb <= 1e-9 && ++j < bids.length) rb = bids[j].size;
  }
  const fees = feeA + feeB + orderExtra(fa, feeA) + orderExtra(fb, feeB);
  return { shares, cost: spend + fees, fees };
}

// Limitless's published sell-fee table (USDC, % of proceeds; peaks at 50¢), interpolated.
const LIMITLESS_SELL: [number, number][] = [
  [0.01, 0.0045], [0.05, 0.006], [0.1, 0.0078], [0.2, 0.0111], [0.3, 0.0132], [0.4, 0.0144], [0.5, 0.015],
  [0.6, 0.0144], [0.7, 0.0132], [0.8, 0.0111], [0.9, 0.0078], [0.95, 0.006], [0.99, 0.0045], [0.999, 0.0042],
];
function interp(t: [number, number][], p: number): number {
  if (p <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (p <= t[i][0]) {
      const [p0, f0] = t[i - 1], [p1, f1] = t[i];
      return f0 + ((p - p0) / (p1 - p0)) * (f1 - f0);
    }
  }
  return t[t.length - 1][1];
}

/** What selling one share at price `p` really nets after the venue's taker fee. */
export function effSell(fee: Fee | undefined, p: number): number {
  if (!fee || fee.kind === "none" || fee.kind === "unknown") return p;
  if (fee.kind === "quad") return p - fee.rate * Math.pow(p * (1 - p), fee.exp ?? 1);
  if (fee.kind === "minp") return p - fee.rate * Math.min(p, 1 - p);
  if (fee.kind === "limitless") return p * (1 - interp(LIMITLESS_SELL, p));
  return p * (1 - fee.rate); // Hyperliquid charges on closing too
}

/**
 * Every venue's levels on one ladder at fee-inclusive prices — asks at what a share really costs,
 * bids at what selling really nets — grouped to 0.1¢, each keeping the venues and sizes in it.
 */
export function mergeAfterFees(books: { venue: string; book: Book | null; fee?: Fee }[]): MergedBook {
  const group = (rows: { venue: string; price: number; size: number }[], dir: 1 | -1): MergedLevel[] => {
    const at = new Map<number, MergedLevel>();
    for (const r of rows) {
      if (!(r.size > 0) || !(r.price > 0) || r.price >= 1) continue;
      const p = Math.round(r.price * 1e3) / 1e3;
      const m = at.get(p) ?? { price: p, size: 0, venues: [] };
      m.size += r.size;
      const v = m.venues.find((x) => x.venue === r.venue);
      if (v) v.size += r.size;
      else m.venues.push({ venue: r.venue, size: r.size });
      at.set(p, m);
    }
    return [...at.values()].sort((a, b) => dir * (a.price - b.price));
  };
  const asks = group(books.flatMap((b) => (b.book?.asks ?? []).map((l) => ({ venue: b.venue, price: effPrice(b.fee, l.price), size: l.size }))), 1);
  const bids = group(books.flatMap((b) => (b.book?.bids ?? []).map((l) => ({ venue: b.venue, price: effSell(b.fee, l.price), size: l.size }))), -1);
  return { asks, bids, bestAsk: asks[0]?.price ?? null, bestBid: bids[0]?.price ?? null };
}

/** A one-line description of the fee, for the fill table. */
export function feeLabel(fee: Fee | undefined): string {
  if (!fee || fee.kind === "none") return "no fee";
  if (fee.kind === "unknown") return `fee unknown (${fee.note})`;
  if (fee.kind === "quad") return `${fee.upTo ? "up to " : ""}${+(fee.rate * 100).toFixed(2)}% × p(1−p)${fee.min ? `, min $${fee.min}` : ""}`;
  if (fee.kind === "minp") return `${+(fee.rate * 100).toFixed(2)}% × min(p, 1−p)`;
  if (fee.kind === "limitless")
    return fee.mode === "collateral" ? `${+((fee.bps ?? 500) / 100).toFixed(2)}% × (1−p) of the stake` : `${+(((fee.bps ?? 300) / 300) * 0.4).toFixed(2)}–${+((fee.bps ?? 300) / 100).toFixed(2)}% of contracts`;
  return `${+(fee.rate * 100).toFixed(2)}% at settlement`;
}

export type VenueAsks = { venue: string; asks: Level[]; fee?: Fee };
export type FeeFill = {
  /** All-in cost per $1 of payout (price + fee). */
  avg: number | null;
  /** Shares held after fees: what the position pays if it wins. */
  payout: number;
  fees: number;
  full: boolean;
  byVenue: { venue: string; usd: number; payout: number; fees: number }[];
};

/**
 * Spend `dollars` across one or more venues' asks, cheapest after fees first — one venue is the
 * plain fill, several is the routed order. Per-order extras (Opinion's $0.25 minimum, Kalshi's
 * rounding up to the cent) are applied to each venue's share at the end.
 */
export function fillAfterFees(books: VenueAsks[], dollars: number): FeeFill {
  const levels = books
    .flatMap((b) => b.asks.filter((l) => l.size > 0 && l.price > 0 && l.price < 1).map((l) => ({ venue: b.venue, fee: b.fee, price: l.price, size: l.size, eff: effPrice(b.fee, l.price) })))
    .sort((a, b) => a.eff - b.eff);
  let left = dollars;
  const by = new Map<string, { venue: string; usd: number; payout: number; fees: number; fee?: Fee }>();
  for (const l of levels) {
    if (left <= 1e-6) break;
    const spend = Math.min(left, l.eff * l.size);
    const got = spend / l.eff;
    const e = by.get(l.venue) ?? { venue: l.venue, usd: 0, payout: 0, fees: 0, fee: l.fee };
    e.usd += spend;
    e.payout += got;
    // A settlement fee comes out of the payout ($1 a share); the others are paid at the entry price.
    e.fees += l.fee?.kind === "settle" ? spend / l.price - got : spend - got * l.price;
    by.set(l.venue, e);
    left -= spend;
  }
  for (const e of by.values()) {
    const f = e.fee;
    let extra = 0;
    if (f?.kind === "quad" && f.min && e.fees < f.min) extra = f.min - e.fees;
    if (f?.kind === "quad" && f.cent) extra += Math.ceil(e.fees * 100 - 1e-9) / 100 - e.fees;
    if (extra > 0) {
      // Paid out of the same budget: fewer shares at this venue's average all-in price.
      const avg = e.usd / e.payout;
      e.payout -= extra / avg;
      e.fees += extra;
    }
  }
  const list = [...by.values()].filter((v) => v.usd >= 0.5).map(({ fee: _f, ...v }) => v).sort((a, b) => b.usd - a.usd);
  const payout = list.reduce((s, v) => s + v.payout, 0);
  const spent = list.reduce((s, v) => s + v.usd, 0);
  return {
    avg: payout > 0 ? spent / payout : null,
    payout,
    fees: list.reduce((s, v) => s + v.fees, 0),
    full: left <= 1e-6,
    byVenue: list,
  };
}
