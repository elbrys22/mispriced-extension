/**
 * A venue's market page, as the reader's browser shows it, turned into what the markets database
 * stores for that venue (the Chrome extension's lookup): the listing's canonical page link or its
 * Kalshi event, plus the sub-market the page has open. Shared by the extension (is this tab a
 * market page?) and the live service's /resolve.
 */
/** A venue listing as the markets database keeps it (lib/marketIndex IndexVenue). */
export type VenueLink = { venue: string; url: string; ref?: string };

export type VenuePage = {
  venue: string;
  /** Candidate listings, most specific first; each is matched whole against a market's venues. */
  keys: { url?: string; ref?: string }[];
  /** The page as a listing to stream when no market is found. */
  link: VenueLink;
  /** The sub-market the page has open (a Polymarket market slug), to preselect its outcome. */
  sub?: string;
  /**
   * What the live service can ask the venue when the link isn't one the database keeps: a
   * Limitless page's readable slug, a Hyperliquid trade path ("#36010", "out:<readable name>").
   */
  find?: { limitless?: string; hl?: string };
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,200}$/i;

export function venuePage(raw: string): VenuePage | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\./, "");
  const seg = u.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));

  if (host === "polymarket.com") {
    // /event/<event>[/<market>], or a game under /sports/<league>/…/<event> (/esports too)
    const ev = seg[0] === "event" ? seg[1] : (seg[0] === "sports" || seg[0] === "esports") && seg.length >= 3 ? seg[seg.length - 1] : null;
    if (!ev || !SLUG.test(ev)) return null;
    const url = `https://polymarket.com/event/${ev.toLowerCase()}`;
    const sub = seg[0] === "event" && seg[2] && SLUG.test(seg[2]) ? seg[2].toLowerCase() : undefined;
    return { venue: "poly", keys: [{ url }], link: { venue: "poly", url }, ...(sub ? { sub } : {}) };
  }

  if (host === "kalshi.com") {
    // /markets/<series>[/<title slug>[/<event or market ticker>]]
    if (seg[0] !== "markets" || !seg[1] || !SLUG.test(seg[1])) return null;
    const series = seg[1].toLowerCase();
    const url = `https://kalshi.com/markets/${series}`;
    const last = seg.length > 2 ? seg[seg.length - 1] : "";
    const keys: VenuePage["keys"] = [];
    // A market ticker is its event's ticker plus one more part: try it whole, then shorter.
    if (last && SLUG.test(last) && last.toLowerCase().startsWith(series)) {
      const parts = last.toUpperCase().split("-");
      for (let n = parts.length; n >= 2; n--) keys.push({ ref: parts.slice(0, n).join("-") });
    }
    keys.push({ url });
    const ref = keys[0]?.ref;
    return { venue: "kalshi", keys, link: { venue: "kalshi", url, ...(ref ? { ref } : {}) } };
  }

  if (host === "limitless.exchange") {
    const i = seg.indexOf("markets");
    const slug = i >= 0 ? seg[i + 1] : null;
    if (!slug || !SLUG.test(slug)) return null;
    const url = `https://limitless.exchange/markets/${slug.toLowerCase()}`;
    // Pages often use the market's readable slug ("spirit-vs-mouz-2026-10-27"), not the one we keep.
    return { venue: "limitless", keys: [{ url }], link: { venue: "limitless", url }, find: { limitless: slug.toLowerCase() } };
  }

  if (host === "app.opinion.trade") {
    if (seg[0] === "market" && seg[1] && SLUG.test(seg[1])) {
      const url = `https://app.opinion.trade/market/${seg[1].toLowerCase()}`;
      return { venue: "opinion", keys: [{ url }], link: { venue: "opinion", url } };
    }
    // A game under /sports/<league>/<slug> (/esports too): the slug is the market's own.
    if ((seg[0] === "sports" || seg[0] === "esports") && seg.length >= 3 && SLUG.test(seg[seg.length - 1])) {
      const url = `https://app.opinion.trade/market/${seg[seg.length - 1].toLowerCase()}`;
      return { venue: "opinion", keys: [{ url }], link: { venue: "opinion", url } };
    }
    const topic = u.searchParams.get("topicId");
    if (seg[0] === "detail" && topic && /^\d{1,12}$/.test(topic)) {
      return { venue: "opinion", keys: [{ ref: `cat:${topic}` }], link: { venue: "opinion", url: `https://app.opinion.trade/detail?topicId=${topic}` } };
    }
    return null;
  }

  if (host === "predict.fun") {
    if (seg[0] !== "market" || !seg[1] || !SLUG.test(seg[1])) return null;
    const url = `https://predict.fun/market/${seg[1].toLowerCase()}`;
    return { venue: "predictfun", keys: [{ url }], link: { venue: "predictfun", url, ref: seg[1].toLowerCase() } };
  }

  if (host === "beta.xo.market" || host === "app.xo.market" || host === "xo.market") {
    // /event/<slug>: the listing is the event (lib/xo xoUrl). beta. now redirects to app.
    if (seg[0] !== "event" || !seg[1] || !SLUG.test(seg[1])) return null;
    const url = `https://beta.xo.market/event/${seg[1].toLowerCase()}`;
    return { venue: "xo", keys: [{ url }], link: { venue: "xo", url } };
  }

  if (host === "outcome.xyz") {
    // Outcome (outcome.xyz) deploys Hyperliquid's outcome markets and numbers them the same way:
    // /markets/<category>/q<question>[?outcome=<outcome>], /markets/<category>/o<outcome>, or a
    // named page (/markets/sports/winner-epl) that adds ?outcome= itself. The picked outcome's
    // coin (10 × outcome, YES side) goes to the live service, which answers its market and label.
    if (seg[0] !== "markets" || seg.length < 3) return null;
    const last = seg[seg.length - 1].toLowerCase();
    const picked = u.searchParams.get("outcome");
    const out = picked && /^\d{1,8}$/.test(picked) ? Number(picked) : /^o\d{1,8}$/.test(last) ? Number(last.slice(1)) : null;
    if (out != null) {
      const url = `https://app.hyperliquid.xyz/trade/%23${out * 10}`;
      return { venue: "hyperliquid", keys: [], link: { venue: "hyperliquid", url }, find: { hl: `#${out * 10}` } };
    }
    const q = /^q(\d{1,8})$/.exec(last);
    if (!q) return null;
    return { venue: "hyperliquid", keys: [{ ref: `q:${q[1]}` }], link: { venue: "hyperliquid", url: "https://app.hyperliquid.xyz/trade" } };
  }

  if (host === "app.hyperliquid.xyz") {
    // /trade/#<coin> (the coin is 10 × outcome + side), which the app turns into a readable path:
    // /trade/<deployer>:<question>-<outcome>-<side> ("out:…-rate-decision-no-change-yes"), or
    // without the deployer for recurring markets. Only the live service can tell which outcome a
    // readable path names; a coin's YES side (…0) is also the link listings keep.
    const path = seg[0] === "trade" ? (seg[1] ?? u.hash) : "";
    const coin = /^#(\d{1,9})$/.exec(path);
    if (coin) {
      const n = Number(coin[1]);
      const url = `https://app.hyperliquid.xyz/trade/%23${n - (n % 10)}`;
      return { venue: "hyperliquid", keys: [{ url }], link: { venue: "hyperliquid", url }, find: { hl: `#${n}` } };
    }
    // A perp ("BTC", "xyz:TSLA") has no dash; an outcome's path always does.
    if (!/^(?:[a-z0-9]{1,20}:)?[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(path) || path.length > 300) return null;
    const url = `https://app.hyperliquid.xyz/trade/${path.toLowerCase()}`;
    return { venue: "hyperliquid", keys: [], link: { venue: "hyperliquid", url }, find: { hl: path.toLowerCase() } };
  }

  return null;
}
