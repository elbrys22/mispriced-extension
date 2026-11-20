/**
 * The comparison the panel and the badge show (design 24d/24e): one outcome and side, an amount
 * in dollars, and each venue's average price after its fee for that amount, against the venue the
 * reader is on. The fee and fill math is the site's (lib/bookMath, components/market/model).
 */
import { fillAfterFees } from "@/lib/bookMath";
import { buildOutcomes, sideBook, type Outcome, type VenueBooks, type VenueState } from "@/components/market/model";
import type { VenueLink as IndexVenue } from "@/lib/venuePage";
import type { RulesOk } from "./api";
import { VENUES, venueLabel } from "./venues";

export type Side = "yes" | "no";

export type Row = {
  venue: string;
  /** The venue lists this market (a dimmed "—" row otherwise). */
  listed: boolean;
  /** Best ask on the chosen side, 0–1. */
  price: number | null;
  /** Average all-in price per $1 payout for the amount (or for what the book holds), 0–1. */
  eff: number | null;
  /** The book fills the whole amount. */
  full: boolean;
  /** What the book fills when it can't take the whole amount, USD. */
  max: number | null;
  here: boolean;
  best: boolean;
  /** This venue words the rules differently from the one the reader is on. */
  rules: boolean;
  /** Difference to the venue the reader is on, 0–1 (negative: cheaper there). */
  vsHere: number | null;
};

export type Verdict =
  | { kind: "here"; eff: number }
  | { kind: "cheaper"; best: string; gap: number; save: number; rules: boolean }
  | { kind: "thin"; best: string; eff: number; hereMax: number | null; rules: boolean }
  | { kind: "none"; deepest: string | null; max: number | null };

/**
 * The outcomes the venues' books add up to (the market page's model). `ended`: the books are in
 * and every outcome has settled, though the market may not be closed in our index yet.
 */
export function outcomesOf(venues: IndexVenue[], state: Record<string, VenueState>, title: string): { live: Outcome[]; ended: boolean } {
  const b = buildOutcomes(venues, state, title);
  const priced = b.live.filter((o) => Object.values(o.books).some((x) => x.asks.length || x.bids.length));
  return { live: b.live, ended: b.settled.length > 0 && !priced.length };
}

/** The outcome a page's sub-market slug names: the one whose words all appear in it. */
export function matchSub(list: Outcome[], sub: string | undefined): Outcome | null {
  if (!sub) return null;
  const slug = new Set(sub.toLowerCase().split("-"));
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1);
  let best: Outcome | null = null, n = 0;
  for (const o of list) {
    const w = words(o.label);
    if (w.length && w.every((x) => slug.has(x)) && w.length > n) [best, n] = [o, w.length];
  }
  return best;
}

/** The outcome a page has open: the one its sub-market slug names, else the first one priced. */
export function pickOutcome(list: Outcome[], sub: string | undefined): Outcome | null {
  if (!list.length) return null;
  // An outcome no venue prices (a game's empty side market) is never the default.
  const priced = list.filter((o) => Object.values(o.books).some((b) => b.asks.length || b.bids.length));
  return matchSub(list, sub) ?? priced[0] ?? list[0];
}

const mid = (b: { bestBid: number | null; bestAsk: number | null }) =>
  b.bestBid != null && b.bestAsk != null ? (b.bestBid + b.bestAsk) / 2 : (b.bestBid ?? b.bestAsk);

/** The venue's own first open outcome: what its page has picked before the reader picks. */
export function firstOn(list: Outcome[], here: string, books: VenueBooks | null | undefined): Outcome | null {
  const own = (books?.outcomes ?? []).filter((ob) => !ob.resolved);
  if (own.some((ob) => ob.order != null)) own.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
  // Kalshi's page lists an event's markets most likely first, not in its API's order.
  else if (here === "kalshi") own.sort((a, b) => (mid(b.book) ?? -1) - (mid(a.book) ?? -1));
  for (const ob of own) {
    const o = list.find((x) => x.vlabels[here] === ob.outcome);
    if (o) return o;
  }
  return null;
}

/** The outcome a venue's own id names (a Kalshi page's ?op_market_ticker=). */
export function matchId(list: Outcome[], here: string, books: VenueBooks | null | undefined, id: string | null): Outcome | null {
  const ob = id ? books?.outcomes.find((x) => x.id?.toUpperCase() === id.toUpperCase()) : null;
  return ob ? (list.find((o) => o.vlabels[here] === ob.outcome) ?? null) : null;
}

// Words run together across tags ("Estac TroyesEstac Troyes" on XO, "Gavin Newsom11%Yes 11¢" on
// Kalshi) come apart at a lower-to-upper case step and between letters and digits; labels go
// through the same, so both sides stay alike.
const norm = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)|(\d)([A-Za-z])/g, (_, a, b, c, d) => (a ? `${a} ${b}` : `${c} ${d}`))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
/** `label` as a whole phrase inside `text` ("October 2" isn't in "October 24"). */
function hasPhrase(text: string, label: string): boolean {
  for (let i = text.indexOf(label); i >= 0; i = text.indexOf(label, i + 1)) {
    const before = text[i - 1], after = text[i + label.length];
    if (!(before && /[a-z0-9]/.test(before)) && !(after && /[a-z0-9]/.test(after))) return true;
  }
  return false;
}

/**
 * A row of another market on the same page ("Spread | Estac Troyes wins by over 1.5 goals", a
 * total, a half, first to score, a map): it names an outcome but isn't a pick of this market. Such
 * a word only counts against a label that doesn't carry it itself ("Over 2.5" stays fine).
 */
const MARKET_WORDS = /\b(by|over|under|spread|spreads|handicap|totals|goals|points|half|halftime|first|score|quarter|period|set|map|corners|cards)\b/g;
const MARKET_WORD = new RegExp(MARKET_WORDS.source);
function otherMarket(text: string, label: string): boolean {
  return (text.match(MARKET_WORDS) ?? []).some((w) => !new RegExp(`\\b${w}\\b`).test(label));
}

/**
 * Game pages show outcomes as short codes with a price: "TRO 46%" (Opinion), "TRO44¢" (Polymarket),
 * "EST 45¢" / "LEH 30¢" (Limitless), "HAC 30¢" (predict.fun). A code is a run of word starts of one
 * outcome's name: "tro" → Troyes, "hac" → Havre AC, "leh" → Le Havre, "draw" → Draw.
 */
const CODE = /([A-Za-z]{3,7})\s*\d{1,3}(?:\.\d+)?\s*[%¢]/;
const CODES = new RegExp(CODE.source, "g");
function codeOf(raw: string): string | null {
  const m = new RegExp(`^${CODE.source}$`).exec(raw.trim());
  const c = m?.[1].toLowerCase();
  return c && !["yes", "buy", "sell"].includes(c) ? c : null;
}
/** Whether `code` is word starts of `name`, in order ("hac" in "le havre ac": h + ac). */
function codeFits(code: string, name: string): boolean {
  const words = name.split(/[^a-z0-9]+/).filter(Boolean);
  const from = (ci: number, wi: number): boolean => {
    if (ci === code.length) return true;
    if (wi >= words.length) return false;
    const w = words[wi];
    for (let k = Math.min(w.length, code.length - ci); k >= 1; k--) if (code.startsWith(w.slice(0, k), ci) && from(ci + k, wi + 1)) return true;
    return false;
  };
  return words.some((_, wi) => from(0, wi));
}
function byCode(list: Outcome[], names: string[][], code: string): Outcome | null {
  const hit = list.filter((_, i) => names[i].some((n) => n === code || codeFits(code, n)));
  return hit.length === 1 ? hit[0] : null;
}
/**
 * The outcome a code button picked, if the click was on this market's own row: every code in the
 * row (the first enclosing block with two or more) names one outcome of this market, each a
 * different one, and the heading above it names no other market (halftime, first to score…).
 */
function matchCode(list: Outcome[], names: string[][], texts: string[]): Outcome | null {
  const code = codeOf(texts[0] ?? "");
  if (!code) return null;
  const o = byCode(list, names, code);
  if (!o) return null;
  const g = texts.findIndex((t) => (t.match(CODES) ?? []).length >= 2);
  if (g >= 0) {
    const row = [...texts[g].matchAll(CODES)].map((m) => m[1].toLowerCase());
    const picks = row.map((c) => byCode(list, names, c));
    if (picks.some((p) => !p) || new Set(picks).size !== picks.length) return null;
    const heading = texts[g + 1];
    if (heading && MARKET_WORD.test(norm(heading))) return null;
  }
  return o;
}

/**
 * The outcome a click on the venue's page picked (content.ts sends the clicked element's text,
 * then each enclosing block's): the first block that names exactly one outcome, by the venue's
 * own label. A block naming several is the list itself, so the click picked none of them; where
 * one name holds the others ("Donald Trump Jr." and "Donald Trump"), the longest is the one.
 */
export function matchClick(list: Outcome[], here: string, texts: string[]): Outcome | null {
  const names = list.map((o) => {
    const ls = [o.vlabels[here], o.label].filter((l): l is string => !!l).map(norm);
    // Opinion's game outcomes read "Estac Troyes wins"; its page buttons say "Estac Troyes".
    const short = ls.map((l) => l.replace(/ (wins|win)$/, ""));
    return [...new Set([...ls, ...short])].filter((l) => l.length > 1 && l !== "yes" && l !== "no");
  });
  if (codeOf(texts[0] ?? "")) return matchCode(list, names, texts);
  for (const raw of texts) {
    const t = norm(raw);
    const hits = list
      .map((o, i) => ({ o, l: names[i].filter((l) => hasPhrase(t, l) && !otherMarket(t, l)).sort((a, b) => b.length - a.length)[0] }))
      .filter((h) => h.l);
    if (hits.length === 1) return hits[0].o;
    if (hits.length > 1) {
      const top = hits.reduce((a, b) => (b.l.length > a.l.length ? b : a));
      return hits.every((h) => h === top || top.l.includes(h.l)) ? top.o : null;
    }
  }
  return null;
}

/** Whether two venues word this outcome's rules alike; unknown until the service answers. */
export function rulesDiffer(r: RulesOk | null, key: string, a: string, b: string): boolean {
  if (!r || r.all || a === b) return false;
  const ok = r.ok[key] ?? [];
  return !ok.includes(`${a}>${b}`) && !ok.includes(`${b}>${a}`);
}

export function compare(o: Outcome | null, venues: IndexVenue[], here: string, side: Side, amt: number, rules: RulesOk | null, off: string[] = []) {
  const listedSet = new Set(venues.map((v) => v.venue));
  const rows: Row[] = VENUES.filter((v) => v.key === here || !off.includes(v.key)).map(({ key }) => {
    const book = sideBook(o?.books[key], side);
    const asks = book?.asks ?? [];
    const row: Row = { venue: key, listed: listedSet.has(key), price: book?.bestAsk ?? null, eff: null, full: false, max: null, here: key === here, best: false, rules: false, vsHere: null };
    if (!o || !asks.length || amt <= 0) return row;
    const f = fillAfterFees([{ venue: key, asks, fee: o.fees[key] }], amt);
    const spent = f.byVenue.reduce((s, v) => s + v.usd, 0);
    row.full = f.full;
    row.eff = f.payout > 0 ? spent / f.payout : null;
    row.max = f.full ? null : spent;
    row.rules = rulesDiffer(rules, o.key, here, key);
    return row;
  });
  const fulls = rows.filter((r) => r.full && r.eff != null).sort((a, b) => a.eff! - b.eff!);
  const best = fulls[0] ?? null;
  const hereRow = rows.find((r) => r.here) ?? null;
  const hereEff = hereRow?.full ? hereRow.eff : null;
  for (const r of rows) {
    r.best = r === best && !r.here;
    r.vsHere = hereEff != null && r.full && r.eff != null && !r.here ? r.eff - hereEff : null;
  }
  // Best first: venues that fill the amount by price, then thin books by depth, then the rest.
  const thin = rows.filter((r) => !r.full && r.eff != null).sort((a, b) => (b.max ?? 0) - (a.max ?? 0));
  const rest = rows.filter((r) => r.eff == null).sort((a, b) => Number(b.listed) - Number(a.listed) || Number(b.here) - Number(a.here));
  const sorted = [...fulls, ...thin, ...rest];

  let verdict: Verdict | null = null;
  if (o && rows.some((r) => r.eff != null)) {
    if (!best) {
      const deepest = thin[0] ?? null;
      verdict = { kind: "none", deepest: deepest?.venue ?? null, max: deepest?.max ?? null };
    } else if (best.here) verdict = { kind: "here", eff: best.eff! };
    else if (hereEff != null) {
      const gap = hereEff - best.eff!;
      verdict = { kind: "cheaper", best: best.venue, gap, save: (amt * gap) / hereEff, rules: best.rules };
    } else verdict = { kind: "thin", best: best.venue, eff: best.eff!, hereMax: hereRow?.max ?? null, rules: best.rules };
  }
  return { rows: sorted, best, verdict };
}

/* --------------------------------- formats --------------------------------- */
/** "34.1¢" from 0–1. */
export const C = (p: number) => `${(Math.round(p * 1000) / 10).toFixed(1)}¢`;
/** The toolbar badge: Chrome shows about 4 characters ("1.4¢", "12¢", "99¢"). */
export const BADGE = (p: number) => {
  const c = p * 100;
  return c < 9.95 ? `${c.toFixed(1)}¢` : `${Math.min(99, Math.round(c))}¢`;
};
/** Money, compact past $1K: "$750", "$8.6K", "$1.2M". */
export const MONEY = (v: number) => {
  const k = (x: number, u: string) => "$" + String(Math.round(x * 10) / 10).replace(/\.0$/, "") + u;
  return v >= 1e9 ? k(v / 1e9, "B") : v >= 1e6 ? k(v / 1e6, "M") : v >= 1e3 ? k(v / 1e3, "K") : "$" + Math.round(v);
};
/** "$25.80" under $1K, compact above. */
export const USD = (v: number) => (v >= 1000 ? MONEY(v) : "$" + v.toFixed(2));

/** The verdict's three lines (design 24d). */
export function verdictText(v: Verdict, here: string, amt: number): { line: string; big: string; small: string; green: boolean; open: string | null } {
  const H = venueLabel(here);
  if (v.kind === "here") return { line: "Best price is here", big: C(v.eff), small: "avg after fees", green: false, open: null };
  if (v.kind === "cheaper") return { line: `${C(v.gap)} cheaper on ${venueLabel(v.best)}`, big: `Save ${USD(v.save)}`, small: `on ${MONEY(amt)}`, green: true, open: v.best };
  if (v.kind === "thin")
    return { line: v.hereMax != null ? `${H} fills only ${MONEY(v.hereMax)}` : `Not priced on ${H}`, big: C(v.eff), small: `avg on ${venueLabel(v.best)}`, green: true, open: v.best };
  return { line: `No venue fills ${MONEY(amt)} alone`, big: v.max != null ? `Max ${MONEY(v.max)}` : "—", small: v.deepest ? `on ${venueLabel(v.deepest)}` : "", green: false, open: null };
}
