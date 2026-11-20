import { flip, type Book } from "@/lib/bookMath";

/**
 * One key per outcome across venues. Venues name a group market's outcomes differently, so the
 * market page (and the price history it charts) match them on this key, not the raw label.
 */

/**
 * Rate-decision outcomes are named differently per venue ("No change" / "Fed maintains rate",
 * "50+ bps decrease" / "Cut >25bps"); map them to one key. Moves come in 25bp steps, so ">25" is 50+.
 */
function rateKey(raw: string): string | null {
  const s = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^(no change|(the )?fed maintains (the )?rates?|maintains? rates?|hold|(hike|cut|increase|decrease) 0 ?bps?)$/.test(s))
    return "rate hold";
  const m = s.match(
    /^(?:(cut|decrease|hike|increase|raise)s? (?:by )?(>|over )?(\d+)(\+)? ?bps?|(>)?(\d+)(\+)? ?bps? (cut|decrease|hike|increase|raise))$/,
  );
  if (!m) return null;
  const down = /cut|decrease/.test(m[1] ?? m[8]);
  const over = !!(m[2] || m[5]);
  const bps = Number(m[3] ?? m[6]) + (over ? 25 : 0);
  return `rate ${down ? "cut" : "hike"} ${bps}${over || m[4] || m[7] ? "+" : ""}`;
}

/**
 * A range outcome keeps its bound: Polymarket's "6+" is 6 or more, Kalshi's "6" is exactly 6, so
 * the symbols become words before punctuation is dropped ("6+" = "6 or more", "<3" = "Below 3").
 * "Above 7" stays apart from "8+": only on whole-number counts are they the same.
 */
const RANGE: [RegExp, string][] = [
  [/^(?:below|under|fewer than|less than) (.+)$/, "below $1"],
  [/^(?:above|over|more than|greater than) (.+)$/, "above $1"],
  [/^at least (.+)$|^(.+) or (?:more|above|higher|greater)$/, "$1$2 plus"],
  [/^at most (.+)$|^(.+) or (?:fewer|less|below|lower)$/, "at most $1$2"],
];

export function outcomeKey(s: string): string {
  const rate = rateKey(s);
  if (rate) return rate;
  const k = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // "Mbappé" = "Mbappe"
    .toLowerCase()
    .replace(/≥|>=/g, " at least ")
    .replace(/≤|<=/g, " at most ")
    .replace(/</g, " below ")
    .replace(/>/g, " above ")
    .replace(/\+/g, " plus ")
    .replace(/(^|\s)[-−](?=\d)/g, "$1minus ") // "Lakers -5.5" isn't "Lakers +5.5"
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  for (const [re, to] of RANGE) if (re.test(k)) return k.replace(re, to).replace(/\s+/g, " ").trim();
  return k;
}

/* ------------------------------ a game's sides ------------------------------ */
// Words that don't tell two clubs apart ("Club Atlético de Madrid" = "Atletico Madrid").
const FILLER = new Set(["fc", "cf", "sc", "afc", "cd", "ac", "club", "de", "del", "la", "the", "team"]);
const words = (s: string) => outcomeKey(s).split(" ").filter((w) => w && !FILLER.has(w));

/** The two sides of an "A vs B" title ("Shanghai Masters: Zverev vs Bublik", "LoL: X vs Y (BO5) - …"). */
export function gameSides(title: string): [string, string] | null {
  const t = title.replace(/\s*\([^)]*\)/g, "").split(/\s+[-–]\s+/)[0];
  const m = t.split(/\s+vs\.?\s+/i);
  if (m.length !== 2) return null;
  const a = m[0].split(":").pop()!.trim(), b = m[1].replace(/\?$/, "").trim();
  return a && b ? [a, b] : null;
}

/**
 * A side's name spelled out for reading a code through it: every word kept ("Paris FC", "SC Braga"),
 * letters accents don't explain written out ("Brøndby" → "brondby"), and German umlauts also as
 * their two-letter form ("Köln" → "koln" and "koeln").
 */
function codeNames(side: string): string[][] {
  const base = side.replace(/[øØ]/g, "o").replace(/[æÆ]/g, "ae").replace(/ß/g, "ss").replace(/[łŁ]/g, "l").replace(/[đĐ]/g, "d");
  const german = base.replace(/[äÄ]/g, "ae").replace(/[öÖ]/g, "oe").replace(/[üÜ]/g, "ue");
  const split = (x: string) => outcomeKey(x).split(" ").filter(Boolean);
  return german === base ? [split(base)] : [split(base), split(german)];
}

/**
 * Codes that don't read through the name: national teams' FIFA codes and clubs known by another name
 * (predict.fun's "ESP" = "Spain", "BIL" = "Athletic Club" of Bilbao). Each maps to words of the side's
 * name as other venues write it.
 */
const CODE_NAMES: Record<string, string[]> = {
  // FIFA codes that aren't the start of the country's English name.
  ALG: ["algeria"], ANG: ["angola"], BAH: ["bahamas"], BAN: ["bangladesh"], BRB: ["barbados"], BUL: ["bulgaria"],
  CHI: ["chile"], CHN: ["china"], CRC: ["costa rica"], CRO: ["croatia"], HRV: ["croatia"], CZE: ["czechia", "czech republic"],
  DEN: ["denmark"], ESP: ["spain"], GER: ["germany"], GRE: ["greece"], GUA: ["guatemala"], HAI: ["haiti"], HON: ["honduras"],
  INA: ["indonesia"], IRL: ["ireland", "republic of ireland"], IRN: ["iran", "ir iran"], KOR: ["korea republic", "south korea"],
  PRK: ["korea dpr", "north korea"], KSA: ["saudi arabia"], KUW: ["kuwait"], LAT: ["latvia"], LIB: ["lebanon"], MAS: ["malaysia"],
  MTN: ["mauritania"], NED: ["netherlands"], NGA: ["nigeria"], NIR: ["northern ireland"], OMA: ["oman"], PAR: ["paraguay"],
  PHI: ["philippines"], POR: ["portugal"], PUR: ["puerto rico"], RSA: ["south africa"], SCO: ["scotland"], SLO: ["slovenia"],
  SUI: ["switzerland"], SVK: ["slovakia"], SWZ: ["eswatini"], TAH: ["tahiti"], TPE: ["chinese taipei"], UAE: ["united arab emirates", "uae"],
  URU: ["uruguay"], USA: ["united states", "usa"], VIE: ["vietnam"], WAL: ["wales"], ZAM: ["zambia"], ZIM: ["zimbabwe"],
  // Clubs known by a city or old name.
  BIL: ["athletic club", "athletic bilbao"], GUI: ["vitoria sc", "vitoria guimaraes"], MIM: ["cf montreal"],
  SHP: ["shanghai haigang", "shanghai port"], SGR: ["shanghai shenhua"],
  BVB: ["borussia dortmund"], SVW: ["werder bremen"], SGE: ["eintracht frankfurt"],
};
const hasWords = (side: string, name: string) => {
  const s = outcomeKey(side).split(" "), n = name.split(" ");
  return s.some((_, i) => n.every((w, j) => s[i + j] === w));
};

/**
 * One venue's label for a side: shared words either way, or a ticker-style code ("ATM", "MNU"). A code
 * reads in order through the name from the start of one of its words, digits included: predict.fun's
 * "DOR" = "Borussia Dortmund", "ELV" = "SV Elversberg", "B04" = "Bayer 04 Leverkusen", "PFC" = "Paris FC";
 * predict.fun's "1" after a taken code is dropped ("MON1" = "CF Monterrey"). A code that fits both
 * sides fits neither (sideIndex).
 */
function isSide(label: string, side: string): boolean {
  const l = words(label), s = words(side);
  if (!l.length || !s.length) return false;
  if (l.every((w) => s.includes(w)) || s.every((w) => l.includes(w))) return true;
  const code = label.trim().replace(/^([A-Z]{3})1$/, "$1");
  return /^[A-Z][A-Z0-9]{1,3}$/.test(code) && codeReads(code, side);
}

/** Which side of an "A vs B" title a team name is: 0, 1, or null when unclear. */
export function sideIndex(label: string, title: string): 0 | 1 | null {
  const sides = gameSides(title);
  if (!sides) return null;
  const a = isSide(label, sides[0]), b = isSide(label, sides[1]);
  return a === b ? null : a ? 0 : 1;
}

/**
 * The outcome key within a market: on a game, every venue's name for a side ("Club Atlético de
 * Madrid", "Atletico Madrid", "ATM") is one outcome, and "Draw" / "Tie" another. Anything that isn't
 * clearly one side falls back to outcomeKey.
 */
export function outcomeKeyIn(label: string, title: string): string {
  const sides = gameSides(title);
  if (sides) {
    if (/^(draw|tie)\b/i.test(label.trim())) return "draw";
    if (WINNER.test(label.trim())) return "match winner";
    const a = isSide(label, sides[0]), b = isSide(label, sides[1]);
    if (a !== b) return outcomeKey(a ? sides[0] : sides[1]);
  }
  return outcomeKey(label);
}

/** "Other" (a venue's catch-all outcome) always lists last. */
export const isOtherOutcome = (label: string) => /^(other|others|any other|field|none of the above)$/i.test(label.trim());

/** A game's who-wins market under its venue names ("Match Winner", "Moneyline", "Winner"). */
const WINNER = /^(match winner|moneyline|winner|to win|match result)$/i;

/**
 * The label to show for a venue's outcome on a game: a nameless two-sided market (Polymarket's
 * moneyline, sides = the teams) is the match winner, not "Yes".
 */
export function gameOutcomeLabel(label: string, title: string, sides?: [string, string]): string {
  if (!label.trim() && sides && sides[0] !== "YES" && gameSides(title)) return "Match Winner";
  return label;
}

// Words that make the whole name the club's name ("Manchester City", "Real Madrid", "Aurora Gaming").
const KEEP_WHOLE = /^(city|united|real|athletic|atletico|sporting|inter|gaming|esports|academy|state|saint|st|san|santa|de|del|da|do|la|le|los|las|el)$/i;
/**
 * A side's short name, when it reads as a person or a city + nickname ("Holger Rune" → "Rune",
 * "Minnesota Timberwolves" → "Timberwolves"); club and team names stay whole.
 */
function shortSide(side: string): string | null {
  const w = side.replace(/\s*\([^)]*\)/g, "").trim().split(/\s+/).filter((x) => !FILLER.has(x.toLowerCase().replace(/\.$/, "")));
  const plain = w.length >= 2 && w.length <= 3 && w.every((x) => /^[A-Z][a-zà-ÿ'’-]+$/.test(x) && !KEEP_WHOLE.test(x.normalize("NFD").replace(/[̀-ͯ]/g, "")));
  return plain ? w[w.length - 1] : null;
}
const SHORT_OVER = 18;
/** A side's name for a tight button: its short name when the full one runs past `max` characters. */
export const shortSideName = (side: string, max = 10) => (side.length > max ? shortSide(side) ?? side : side);

/**
 * How a game's who-wins outcome is shown: the matchup ("100 Thieves vs Liquid"), whatever a venue
 * calls it; a long one by last names when both sides have one ("Rune vs Halys" for "Holger Rune
 * vs Quentin Halys"), so the two read alike ("Aston Villa vs Manchester City" stays whole).
 */
export function shownLabel(label: string, key: string, title: string): string {
  const sides = key === "match winner" ? gameSides(title) : null;
  if (!sides) return label;
  const full = `${sides[0]} vs ${sides[1]}`;
  const a = shortSide(sides[0]), b = shortSide(sides[1]);
  return full.length > SHORT_OVER && a && b ? `${a} vs ${b}` : full;
}
export const isMatchWinner = (key: string) => key === "match winner";

/**
 * A game's side market ("NIP vs Heroic - Map 2 Winner", "O/U 2.5 Games", "First Half") mirrors the
 * same Polymarket event as the match itself, so a shared event key isn't enough: a side market
 * only joins a row that names the same side market. "" for a market about the whole event.
 */
export function sideMarketTag(title: string): string {
  const m = /\b(map|game|set|half|quarter|period|round|inning)\s*(\d+)\b|\b(o\/u|over\/under|total|handicap|spread|exact score|first (?:blood|team|to)|both teams|corners|cards)\b/i.exec(title);
  if (!m) return "";
  return (m[1] ? `${m[1]} ${m[2]}` : m[3]).toLowerCase();
}

/**
 * A game listed as one nameless binary whose YES is the title's second team ("Guardians vs Rays"
 * on a "Rays vs Guardians" page): flipped so YES is the first team, like every other venue's.
 * `flipped` says the venue's own YES history reads the other way.
 */
export function alignGameBinary<T extends { outcome: string; book: Book; sides?: [string, string]; chg24?: number; resolved?: "yes" | "no" }>(
  ob: T,
  title: string,
): { ob: T; flipped: boolean } {
  if (ob.outcome.trim() || !ob.sides || sideMarketTag(title) || !gameSides(title)) return { ob, flipped: false };
  if (sideIndex(ob.sides[0], title) !== 1 || sideIndex(ob.sides[1], title) === 1) return { ob, flipped: false };
  return {
    flipped: true,
    ob: {
      ...ob,
      book: flip(ob.book),
      sides: [ob.sides[1], ob.sides[0]],
      chg24: ob.chg24 != null ? -ob.chg24 : undefined,
      resolved: ob.resolved === "yes" ? "no" : ob.resolved === "no" ? "yes" : undefined,
    },
  };
}

/* --------------------- Kalshi's outcome names → the other venues' keys --------------------- */
/**
 * Kalshi names a market's outcomes its own way: "Paderborn" for "SC Paderborn", "Pittsburgh" for
 * "Pittsburgh Steelers", "Chicago C" for "Chicago Cubs", "Dallas" for "Dallas, TX", "Grace Meng"
 * for "Grace Meng (D)". Their keys never meet, so its book sat apart from the outcome. kalshiAliases
 * files such a Kalshi outcome (by ticker) under the key another venue uses, only when the pairing
 * is certain:
 *  - a range: both labels are the same numeric range once units are dropped ("At least 59" =
 *    "59.0+"); "9+" is not "9", "80+" is not "Above 80" (Kalshi's is strictly above). Never
 *    Kalshi's daily temperatures: its "44° to 45°" settles on another station or report than
 *    Polymarket's "44-45°F" (Chicago Midway vs O'Hare), so they are different outcomes;
 *  - a name: every word of one is in the other (a lone letter stands for a word: "Chicago C",
 *    "U de Chile", "C.T. Pan"), with a shared word of 3+ letters. When Kalshi's name is the
 *    shorter or uses initials ("Los Angeles", "New York G"), its ticker's code must also read
 *    through the other name ("…-LAD" through "Los Angeles Dodgers", never "Los Angeles Angels");
 *  - a party race (Kalshi's "-D" / "-R" market is that party winning): another venue's "Democrat",
 *    or its "(D)" candidate when the surnames agree ("Dave Dawson" for "David Dawson (D)"); a "(D)"
 *    name never pairs with an "-R" ticker;
 *  - one to one: same-name fits are settled first, then looser ones among what is left; a Kalshi
 *    outcome that fits two outcomes, or shares one with another, is left apart (counted as refused).
 * Never: a label with alternatives ("Anthropic / Claude", "Argentina, Uruguay, or Paraguay"), a
 * qualifier in brackets ("Florida (Special)"), or a game ("A vs B": its sides line up in outcomeKeyIn).
 */
export type AliasIn = { venue: string; label: string; id?: string };
const PARTY_MARK = /\s*\((D|R|I)\)\s*$/;
const CODE_MARK = /\s*\(([A-Z0-9.]{1,6})\)\s*$/;
const UNIT = /\s*(?:°\s*[fc]?|º\s*[fc]?|degrees?(?: fahrenheit| celsius)?|%)/gi;
type Range = { kind: "eq" | "between" | "atMost" | "atLeast" | "below" | "above"; a: number; b?: number };
function rangeOf(label: string): Range | null {
  const s = label.toLowerCase().replace(UNIT, "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  const n = String.raw`(-?\d+(?:\.\d+)?)`;
  let m: RegExpMatchArray | null;
  if ((m = s.match(new RegExp(`^${n}$`)))) return { kind: "eq", a: +m[1] };
  if ((m = s.match(new RegExp(`^${n} ?(?:-|to) ?${n}$`)))) return { kind: "between", a: +m[1], b: +m[2] };
  if ((m = s.match(new RegExp(`^${n} ?(?:or (?:below|lower|less|fewer|under))$|^(?:at most|≤) ?${n}$`)))) return { kind: "atMost", a: +(m[1] ?? m[2]) };
  if ((m = s.match(new RegExp(`^${n} ?(?:\\+|or (?:above|higher|more|greater|over))$|^(?:at least|≥) ?${n}$`)))) return { kind: "atLeast", a: +(m[1] ?? m[2]) };
  if ((m = s.match(new RegExp(`^(?:below|under|less than|fewer than|<) ?${n}$`)))) return { kind: "below", a: +m[1] };
  if ((m = s.match(new RegExp(`^(?:above|over|more than|greater than|>) ?${n}$`)))) return { kind: "above", a: +m[1] };
  return null;
}
const sameRange = (x: Range, y: Range) => x.kind === y.kind && x.a === y.a && x.b === y.b;

const NAME_FILLER = new Set([...FILLER, "and", "of"]);
/** A name's words for pairing, or null when it can't be paired safely (alternatives, a bracketed qualifier). */
function nameWords(label: string): { words: string[]; party?: string } | null {
  let s = label.trim(), party: string | undefined;
  const p = s.match(PARTY_MARK);
  if (p) { party = p[1]; s = s.replace(PARTY_MARK, ""); }
  s = s.replace(CODE_MARK, "").replace(STATE_MARK, ""); // "Okta (OKTA)", "Dallas, TX"
  if (/[()[\]]/.test(s) || /\/|\bor\b/i.test(s)) return null;
  const words = outcomeKey(s.replace(/[.]/g, " ")).split(" ").filter((w) => w && !NAME_FILLER.has(w) && w !== "plus");
  return words.length ? { words, party } : null;
}
const STATE_MARK = /,\s*[A-Z]{2}$/;
/** Initials written apart joined up: "T.J. Rumfield" = "TJ Rumfield". */
function joinInitials(ws: string[]): string[] {
  const out: string[] = [];
  let run = false;
  for (const w of ws) {
    if (w.length === 1 && run) out[out.length - 1] += w;
    else {
      out.push(w);
      run = w.length === 1;
    }
  }
  return out;
}
/** The numbers in a label (decimals whole) and how they bound it: "Graham 0-5%" ≠ "Graham, 0.5+ pts", "Brown 12" ≠ "Brown 12+". */
function numSig(label: string): string {
  const t = label.toLowerCase();
  const nums = (t.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).sort((a, b) => a - b).join(",");
  if (!nums) return "";
  const mark = /\d\s*(?:[-–]|to)\s*\d/.test(t) ? "range"
    : /\+|or (?:more|above|higher|greater|over)|at least|≥/.test(t) ? "ge"
    : /or (?:less|fewer|below|lower|under)|at most|≤/.test(t) ? "le"
    : /\b(?:above|over|more than|greater than)\b|>/.test(t) ? "gt"
    : /\b(?:below|under|less than|fewer than)\b|</.test(t) ? "lt"
    : "eq";
  return `${mark}:${nums}`;
}
/** Every word of `small` has its own word in `big` (a lone letter: a word starting with it). */
function covers(small: string[], big: string[]): boolean {
  const used = new Set<number>();
  return small.every((t) => {
    const i = big.findIndex((w, j) => !used.has(j) && (w === t || (t.length === 1 && w.length > 1 && w[0] === t)));
    if (i < 0) return false;
    used.add(i);
    return true;
  });
}
const sameWords = (a: string[], b: string[]) => a.length === b.length && covers(a, b) && a.every((w) => b.includes(w));
/** A ticker-style code read in order through a name, from the start of one of its words ("LAD" through "Los Angeles Dodgers"). */
function codeReads(code: string, side: string): boolean {
  if (CODE_NAMES[code]?.some((n) => hasWords(side, n))) return true;
  const c = code.toLowerCase();
  return codeNames(side).some((name) =>
    name.some((w, start) => {
      if (w[0] !== c[0]) return false;
      let i = 0;
      for (const ch of name.slice(start).join("")) if (ch === c[i]) i++;
      return i === c.length;
    }),
  );
}
const partyOf = (label: string) => (/^(the )?democrat(ic)?s?( party)?$/i.test(label.trim()) ? "D" : /^(the )?republicans?( party)?$/i.test(label.trim()) ? "R" : null);
const TEMPERATURE = /^KX(?:HIGH|LOW)/;
const STAKES = /\b(advances?|to advance|qualif\w*|relegat\w*|promot\w*|nominee|nominat\w*|runner.?up|top \d+|podium|jr|sr|ii|iii)\b/i;
/** Kalshi series whose "-D" / "-R" market is that party winning the race. */
const PARTY_SERIES = /HOUSE|SENATE|GOV|ATTYGEN|SECSTATE|MAYOR/;

/**
 * How surely Kalshi's outcome (label, ticker) names the other venue's outcome `other`: 1 the same
 * (same range, same words, a party's market), 2 a looser fit (some words, initials, a nickname on
 * the party's ticker), 0 not at all.
 */
function kalshiFit(label: string, ticker: string, other: string): 0 | 1 | 2 {
  const parts = ticker.split("-");
  const code = parts[parts.length - 1] ?? "";
  const partyRace = /^[DR]$/.test(code) && PARTY_SERIES.test(parts[0] ?? "");
  // Temperature: Kalshi settles on the NWS daily climate report, often at another station (Chicago Midway, DFW)
  // than Polymarket's airport METAR (O'Hare, Love Field): "44-45°F" there isn't Kalshi's "44° to 45°".
  if (TEMPERATURE.test(parts[0] ?? "")) return 0;
  // Ranges: both must read as one, and the same one.
  const rk = rangeOf(label), ro = rangeOf(other);
  if (rk || ro) return rk && ro && sameRange(rk, ro) ? 1 : 0;
  // A party's market under its party's name ("Democrat" for "-D", or Kalshi's "Republican party" for "Dan Sullivan (R)").
  const po = partyOf(other), pk = partyOf(label);
  if (po || pk) {
    if (!partyRace) return 0;
    if (po) return po === code ? 2 : 0;
    return other.match(PARTY_MARK)?.[1] === code ? 2 : 0;
  }
  const k = nameWords(label), o = nameWords(other);
  if (!k || !o) return 0;
  if (o.party && /^[DRI]$/.test(code) && code !== o.party) return 0;
  if (numSig(label) !== numSig(other)) return 0;
  // A word that changes what the outcome is ("Pontevedra advances" isn't "Pontevedra" winning the game).
  if (STAKES.test(label) !== STAKES.test(other)) return 0;
  for (const [kw, ow] of [[k.words, o.words], [joinInitials(k.words), joinInitials(o.words)]]) {
    if (sameWords(kw, ow)) return 1;
    if (!kw.some((w) => w.length >= 3 && ow.includes(w))) continue;
    const kInO = covers(kw, ow), oInK = covers(ow, kw);
    if (!kInO && !oInK) continue;
    // Kalshi's is the less specific name (fewer words, or initials): its ticker code must read through the other.
    const kalshiShort = kInO && (kw.length < ow.length || kw.some((w) => w.length === 1));
    if (!kalshiShort) return 2;
    if (partyRace && o.party === code) return 2; // "Grace Meng" on "-D" for "Grace Meng (D)"
    if (/^[A-Z][A-Z0-9]{1,5}$/.test(code) && codeReads(code, other.replace(PARTY_MARK, "").replace(STATE_MARK, ""))) return 2;
  }
  // The party's one candidate in the race, under a nickname ("Dave Dawson" on "-D" for "David Dawson (D)").
  if (partyRace && o.party === code && k.words.length >= 2 && k.words[k.words.length - 1] === o.words[o.words.length - 1] && k.words[k.words.length - 1].length >= 3) return 2;
  return 0;
}

/**
 * Kalshi outcomes to file under another venue's key: ticker → key. `outs` is every venue's outcomes
 * on the market (resolved ones too, so a settled look-alike still counts against a pairing).
 * Same-name fits are settled first ("Cerro Largo FC" = "Cerro Largo"), then looser ones among what
 * is left ("CA Cerro" = "Cerro"); at each step a pairing stands only when it is one to one.
 * `refused` counts Kalshi outcomes that fit something but couldn't be paired one to one.
 */
export function kalshiAliases(outs: AliasIn[], title: string): { map: Map<string, string>; refused: number } {
  const map = new Map<string, string>();
  if (gameSides(title)) return { map, refused: 0 };
  const keyOf = (o: AliasIn) => outcomeKeyIn(o.label, title);
  const kalshi = outs.filter((o) => o.venue === "kalshi" && o.id && o.label.trim());
  if (!kalshi.length) return { map, refused: 0 };
  const kalshiKeys = new Set(kalshi.map(keyOf));
  const otherKeys = new Set(outs.filter((o) => o.venue !== "kalshi" && o.label.trim()).map(keyOf));
  // Keys other venues use that no Kalshi outcome has: each with every label it goes by.
  const open = new Map<string, string[]>();
  for (const o of outs) {
    if (o.venue === "kalshi" || !o.label.trim()) continue;
    const k = keyOf(o);
    if (kalshiKeys.has(k)) continue;
    const ls = open.get(k) ?? [];
    if (!ls.includes(o.label)) ls.push(o.label);
    open.set(k, ls);
  }
  if (!open.size) return { map, refused: 0 };
  const fit = new Map<string, Map<string, 1 | 2>>(); // ticker → key → tier
  for (const o of kalshi) {
    for (const [k, labels] of open) {
      let best: 0 | 1 | 2 = 0;
      for (const l of labels) {
        const f = kalshiFit(o.label, o.id!, l);
        if (f && (!best || f < best)) best = f;
      }
      if (best) (fit.get(o.id!) ?? fit.set(o.id!, new Map()).get(o.id!)!).set(k, best);
    }
  }
  // Kalshi outcomes already lined up by name stay where they are, but still count as rivals.
  const free = (t: string) => !otherKeys.has(keyOf(kalshi.find((o) => o.id === t)!));
  const takenKeys = new Set<string>();
  for (const tier of [1, 2] as const) {
    const keysOf = (t: string) => [...fit.get(t)!].filter(([k, f]) => f <= tier && !takenKeys.has(k)).map(([k]) => k);
    const pool = [...fit.keys()].filter((t) => !map.has(t));
    const pick: [string, string][] = [];
    for (const t of pool) {
      if (!free(t)) continue;
      const ks = keysOf(t);
      if (ks.length === 1 && !pool.some((u) => u !== t && keysOf(u).includes(ks[0]))) pick.push([t, ks[0]]);
    }
    for (const [t, k] of pick) {
      map.set(t, k);
      takenKeys.add(k);
    }
  }
  const refused = [...fit.keys()].filter((t) => free(t) && !map.has(t)).length;
  return { map, refused };
}
