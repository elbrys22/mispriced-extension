/**
 * The side panel (design 24d, states 24e): the market the reader has open on a venue, on every
 * venue we cover, with each venue's average price after its fee for the chosen amount.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { venuePage } from "@/lib/venuePage";
import type { VenueLink as IndexVenue } from "@/lib/venuePage";
import { olderThan, resolve, rulesOk, type Resolved, type RulesOk } from "./api";
import { C, compare, firstOn, matchClick, matchId, matchSub, MONEY, outcomesOf, pickOutcome, rulesDiffer, verdictText, type Row, type Side } from "./compare";
import { saveNotice, useNotice } from "./notice";
import { getPick, isPick, samePage } from "./picks";
import { DEFAULTS, getSettings, MAX_AMOUNT, onSettings, type Settings } from "./settings";
import { amountText, ConsentBody, FollowX, Logo, NoticeBar, parseAmount, Parts, Seg, useConsent, VenueChip } from "./ui";
import { useActiveTab } from "./useActiveTab";
import { STALE_MS, useBooks } from "./useBooks";
import { pageLink, RELEASES, SITE, VENUES, venueLabel } from "./venues";

const VERSION = chrome.runtime.getManifest().version;

/** A tab title without the venue's name ("Fed Decision in December? | Polymarket"). */
const cleanTitle = (t: string) => t.replace(/\s*[|\-–—·]\s*(Polymarket|Kalshi|Limitless|Opinion|predict\.fun|Hyperliquid)\b.*$/i, "").trim();
const endLabel = (ts: number | null) => {
  if (!ts) return null;
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString()) return "Today";
  const year = d.getFullYear() !== new Date().getFullYear();
  return `${ts < Date.now() ? "ended" : "ends"} ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) })}`;
};
const agoText = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))}s ago` : `${Math.round(ms / 60_000)} min ago`);

type Lookup = { url: string; status: "loading" | "ok" | "error"; data: Resolved | null };

function useSettings(): Settings {
  const [s, setS] = useState<Settings>(DEFAULTS);
  useEffect(() => {
    void getSettings().then(setS);
    return onSettings(setS);
  }, []);
  return s;
}

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Which market the page shows; asked again when the page changes, kept while it's the same market page. */
function useLookup(url: string | null): Lookup | null {
  const page = useMemo(() => (url ? venuePage(url) : null), [url]);
  const key = page ? JSON.stringify([page.keys, page.sub ?? "", page.find ?? null]) : null;
  const [l, setL] = useState<Lookup | null>(null);
  useEffect(() => {
    if (!url || !key) return setL(null);
    const ac = new AbortController();
    let tries = 0;
    const run = () =>
      resolve(url, ac.signal)
        .then((data) => {
          saveNotice(data.notice);
          setL({ url, status: "ok", data });
        })
        .catch(() => {
          if (ac.signal.aborted) return;
          setL((prev) => ({ url, status: "error", data: prev?.data ?? null }));
          if (++tries < 20) setTimeout(run, 10_000);
        });
    // A different market page: forget the last one at once. Hyperliquid's link changes with the
    // outcome picked, so there the market stays up while the new link is looked up.
    const keep = page?.venue === "hyperliquid";
    setL((prev) => ({ url, status: "loading", data: keep && prev?.data && venuePage(prev.url)?.venue === "hyperliquid" ? prev.data : null }));
    void run();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return l;
}

function Panel() {
  const tab = useActiveTab();
  const settings = useSettings();
  const now = useNow(1000);
  const consent = useConsent();
  // Nothing goes to our server until the reader allows it (design 24g).
  const lookup = useLookup(consent ? (tab?.url ?? null) : null);
  const data = lookup?.data ?? null;

  const outdated = !!data && olderThan(VERSION, data.ext);
  // A newer release is out (the service asks GitHub): the header offers it until it's installed.
  const update = !!data?.latest && olderThan(VERSION, data.latest) ? data.latest : null;
  const here = data?.here.venue ?? (tab?.url ? venuePage(tab.url)?.venue : null) ?? null;
  const market = data?.kind === "market" ? data.market : null;
  const venues: IndexVenue[] = useMemo(() => {
    if (!data || outdated || (market && !market.open)) return [];
    if (data.kind === "none") return [data.here.link];
    return data.market.venues.filter((v) => v.venue === data.here.venue || !settings.off.includes(v.venue));
  }, [data, market, outdated, settings.off]);
  const title = market?.title ?? cleanTitle(tab?.title ?? "");
  const { state, lastAt, failed } = useBooks(venues);

  const [rules, setRules] = useState<RulesOk | null>(null);
  useEffect(() => {
    setRules(null);
    if (market?.open) void rulesOk(market.href).then(setRules);
  }, [market?.href, market?.open]);

  const { live: outcomes, ended } = useMemo(() => outcomesOf(venues, state, title), [venues, state, title]);
  const [outKey, setOutKey] = useState<string | null>(null);
  const [outOpen, setOutOpen] = useState(false);
  const [side, setSide] = useState<Side>("yes");
  const [amt, setAmt] = useState<number | null>(null);
  const marketId = market?.href ?? (data?.kind === "none" ? data.here.link.url : null);
  useEffect(() => {
    setOutKey(null);
    setOutOpen(false);
    setSide("yes");
  }, [marketId]);

  // Follow the outcome picked on the venue's page, whichever came last: the panel's own pick, a
  // click on the page (content.ts: Polymarket, Limitless, Opinion, predict.fun), or the link
  // (Kalshi's ?op_market_ticker=, Hyperliquid's path, a Polymarket sub-market).
  const ticker = here === "kalshi" && tab?.url ? new URL(tab.url).searchParams.get("op_market_ticker") : null;
  const sub = data?.here.sub;
  useEffect(() => setOutKey(null), [ticker, sub]);
  const [click, setClick] = useState<{ texts: string[] } | null>(null);
  useEffect(() => {
    setClick(null);
    if (tab?.id == null || !tab.url) return;
    const { id, url } = tab;
    void getPick(id).then((p) => p && samePage(p.url, url) && setClick({ texts: p.texts }));
    const on = (m: unknown, sender: chrome.runtime.MessageSender) => {
      if (isPick(m) && sender.tab?.id === id) setClick({ texts: m.texts });
    };
    chrome.runtime.onMessage.addListener(on);
    return () => chrome.runtime.onMessage.removeListener(on);
  }, [tab?.id, tab?.url]);
  useEffect(() => {
    if (!click || !here || !outcomes.length) return;
    const o = matchClick(outcomes, here, click.texts);
    if (o) {
      setOutKey(o.key);
      setOutOpen(false);
    }
    setClick(null);
  }, [click, here, outcomes]);

  const amount = amt ?? settings.amount;
  const hereBooks = here ? state[here]?.books : null;
  const outcome =
    outcomes.find((o) => o.key === outKey) ??
    (here ? matchId(outcomes, here, hereBooks, ticker) : null) ??
    matchSub(outcomes, sub) ??
    (here ? firstOn(outcomes, here, hereBooks) : null) ??
    pickOutcome(outcomes, undefined);

  const booksIn = Object.values(state).some((s) => s.books);
  // Can't refresh: the lookup failed, every stream is down, or the newest price is too old.
  const stale = (lookup?.status === "error" && !data) || failed || (lastAt != null && now - lastAt > STALE_MS);
  const cmp = useMemo(() => (here ? compare(outcome, venues, here, side, amount, rules, settings.off) : null), [outcome, venues, here, side, amount, rules, settings.off]);

  /* ------------------------------ states without prices ------------------------------ */
  const footSite = (
    <Footer href={SITE} label="Open mispriced.fi ↗" />
  );
  if (!tab?.url || !venuePage(tab.url))
    return (
      <Shell ago="">
        <Message title="Open a market to compare prices" body="On a market page of any of these venues, this panel shows the same market on the others, after fees.">
          <span className="chips">
            {VENUES.map((v) => (
              <VenueChip key={v.key} venue={v.key} />
            ))}
          </span>
        </Message>
        {footSite}
      </Shell>
    );
  if (!consent)
    return (
      <Shell ago="">
        {consent === false && (
          <>
            <MarketHead meta="" title={cleanTitle(tab.title ?? "")} here={venuePage(tab.url)?.venue ?? null} />
            <div className="card msg consent">
              <span className="card-t">Allow price lookups</span>
              <ConsentBody />
            </div>
          </>
        )}
        {footSite}
      </Shell>
    );
  if (outdated)
    return (
      <Shell ago="">
        <Message title="Update Mispriced to see prices" body="This version can't show prices anymore. Download the new version, replace the old folder and reload the extension. Your settings stay.">
          <a className="btn-primary" href={RELEASES} target="_blank" rel="noreferrer">
            Download Update ↗
          </a>
        </Message>
        {footSite}
      </Shell>
    );
  if (market && (!market.open || ended))
    return (
      <Shell ago="">
        <MarketHead meta={metaLine(market.category, market.endTs, market.venues.length)} title={title} here={here} />
        <Message title="This market has ended" body="Trading is closed on every venue that listed it." />
        <Footer href={SITE + market.href} label="Open full market on mispriced ↗" />
      </Shell>
    );

  /* --------------------------------- the comparison --------------------------------- */
  const loading = !data || (!booksIn && !failed);
  const v = !stale && !loading && cmp?.verdict && outcome ? verdictText(cmp.verdict, here!, amount) : null;
  const best = cmp?.verdict && (cmp.verdict.kind === "cheaper" || cmp.verdict.kind === "thin") ? cmp.verdict : null;
  const linkOf = (venue: string) => {
    const l = venues.find((x) => x.venue === venue);
    return l ? pageLink(l) : null;
  };
  const listedN = market ? new Set(market.venues.map((x) => x.venue)).size : 1;
  const sideL = side === "yes" ? "Buy Yes" : "Buy No";
  return (
    <Shell ago={lastAt ? `updated ${agoText(now - lastAt)}` : data && !stale ? "loading…" : ""} agoWarn={!!stale && !!lastAt} update={update}>
      <div className="scroll">
        <MarketHead meta={market ? metaLine(market.category, market.endTs, listedN) : `${listedN} of 6 venues`} title={title} here={here} />

        {outcomes.length > 1 && (
          <div className="out-wrap">
            <button type="button" className="out-btn" onClick={() => setOutOpen(!outOpen)} aria-expanded={outOpen}>
              <span className="out-text">
                <span className="label">{outcomes.length} Outcomes</span>
                <span className="out-name">{outcome?.label}</span>
              </span>
              <span className="out-chance">{outcome?.cons.p != null ? `${(outcome.cons.p * 100).toFixed(1)}%` : "—"}</span>
              <span className="caret">{outOpen ? "▲" : "▼"}</span>
            </button>
            {outOpen && (
              <div className="out-list">
                {outcomes.map((o) => (
                  <button
                    type="button"
                    key={o.key}
                    className={o.key === outcome?.key ? "on" : ""}
                    onClick={() => {
                      setOutKey(o.key);
                      setOutOpen(false);
                    }}
                  >
                    <span>{o.label}</span>
                    <span className="muted">{o.cons.p != null ? `${(o.cons.p * 100).toFixed(1)}%` : "—"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="controls">
          <Seg label="Side" wide items={[["yes", "Buy Yes"], ["no", "Buy No"]]} value={side} onPick={setSide} />
          <div className="amount-row">
            <label className="amount">
              <span>$</span>
              <input value={amountText(amount)} onChange={(e) => setAmt(parseAmount(e.target.value, MAX_AMOUNT))} aria-label="Amount in dollars" placeholder="Amount" inputMode="numeric" />
            </label>
            <Seg label="Quick amounts" items={[[100, "$100"], [500, "$500"], [1000, "$1K"]]} value={amount} onPick={setAmt} />
          </div>
        </div>

        {stale && (
          <div className="stale">
            <span className="stale-t">Can't refresh prices right now</span>
            <span className="stale-b">{lastAt ? `Showing prices from ${agoText(now - lastAt)}. Trying again every 10s.` : "Trying again every 10s."}</span>
          </div>
        )}
        {!stale && loading && <div className="verdict skel" />}
        {v && (
          <div className={v.green ? (best?.rules ? "verdict green warn" : "verdict green") : "verdict"}>
            <span className="v-line">{v.line}</span>
            <span className="v-main">
              <span className="v-big">{v.big}</span>
              <span className="v-small">{v.small}</span>
            </span>
            {best?.rules && <span className="v-warn">Rules differ, check them first</span>}
            {v.open && linkOf(v.open) && (
              <a className="btn-primary" href={linkOf(v.open)!} target="_blank" rel="noreferrer">
                Open on {venueLabel(v.open)} ↗
              </a>
            )}
          </div>
        )}

        <div className="best-head">
          <span className="best-title">Best price</span>
          <span className="label">
            {sideL}
            {outcomes.length > 1 && outcome ? ` on ${outcome.label}` : ""}
            <span className="sep"> | </span>
            {MONEY(amount)}
          </span>
        </div>
        <div className="row row-head">
          <span>Venue</span>
          <span>Price</span>
          <span>After Fees</span>
          <span>Vs Here</span>
        </div>
        {(cmp?.rows ?? []).map((r) => (
          <VenueRow key={r.venue} r={r} href={r.listed ? linkOf(r.venue) : null} skel={!stale && r.listed && !state[r.venue]?.books && !state[r.venue]?.failed} dim={!!stale} />
        ))}

        {data?.kind === "none" && (
          <div className="card">
            <span className="card-t">Only on {venueLabel(here!)} so far</span>
            <span className="card-b">No other venue lists this market yet. Prices from other venues show up here as soon as one does.</span>
          </div>
        )}

        {market && rules && outcome && <RulesNote rules={rules} outKey={outcome.key} here={here!} venues={[...new Set(market.venues.map((x) => x.venue))]} />}
      </div>
      <Footer href={market ? SITE + market.href : SITE} label={market ? "Open full market on mispriced ↗" : "Open mispriced.fi ↗"} />
    </Shell>
  );
}

const metaLine = (category: string, endTs: number | null, n: number) => <Parts items={[category, endLabel(endTs), `${n} of 6 venues`].filter(Boolean)} />;

function Shell({ ago, agoWarn, update, children }: { ago: string; agoWarn?: boolean; update?: string | null; children: React.ReactNode }) {
  const { notice, close } = useNotice();
  return (
    <div className="panel">
      <header className="head">
        <span className="wordmark">mispriced.</span>
        <span className={agoWarn ? "ago warn" : "ago"}>{ago}</span>
      </header>
      {notice && <NoticeBar notice={notice} onClose={close} />}
      {update && (
        <a className="update" href={RELEASES} target="_blank" rel="noreferrer">
          <Parts items={[`Version ${update} is out`, "Download ↗"]} />
        </a>
      )}
      {children}
    </div>
  );
}

function MarketHead({ meta, title, here }: { meta: ReactNode; title: string; here: string | null }) {
  return (
    <div className="market">
      <span className="meta">{meta}</span>
      <span className="title">{title || "…"}</span>
      {here && (
        <span className="here">
          <Logo venue={here} size={12} />
          You're on {venueLabel(here)}
        </span>
      )}
    </div>
  );
}

function Message({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="card msg">
      <span className="card-t">{title}</span>
      <span className="card-b">{body}</span>
      {children}
    </div>
  );
}

function Footer({ href, label }: { href: string; label: string }) {
  return (
    <footer className="foot">
      <a className="btn-ghost" href={href} target="_blank" rel="noreferrer">
        {label}
      </a>
      <FollowX />
      <span className="fine">
        <Parts items={["Live prices", "fees included", "not a trading tool"]} />
      </span>
    </footer>
  );
}

function VenueRow({ r, href, skel, dim }: { r: Row; href: string | null; skel: boolean; dim: boolean }) {
  const name = (
    <span className="v-name">
      <Logo venue={r.venue} />
      <span className="v-label">{venueLabel(r.venue)}</span>
      {r.here && <span className="tag tag-here">Here</span>}
      {r.best && <span className="tag tag-best">Best</span>}
      {r.rules && <span className="tag tag-rules">Rules</span>}
    </span>
  );
  const vs = r.here ? "here" : r.eff == null ? "—" : !r.full ? `max ${MONEY(r.max ?? 0)}` : r.vsHere == null ? "—" : Math.abs(r.vsHere) < 0.0005 ? "same" : `${r.vsHere < 0 ? "−" : "+"}${C(Math.abs(r.vsHere))}`;
  const vsCls = r.vsHere != null && r.vsHere < 0 ? "num green" : r.eff == null || r.here ? "num faint" : !r.full ? "num muted depth" : "num muted";
  const cells = skel ? (
    <>
      <span className="sk sk1" />
      <span className="sk sk2" />
      <span className="sk sk3" />
    </>
  ) : (
    <>
      <span className="num muted">{r.price != null ? C(r.price) : "—"}</span>
      <span className={r.best ? "num green" : r.full ? "num" : "num dim"}>{r.eff != null ? C(r.eff) : "—"}</span>
      <span className={vsCls}>{vs}</span>
    </>
  );
  const cls = `row${r.best ? " row-best" : ""}${!r.listed || (r.eff == null && !skel) ? " row-off" : ""}${dim && r.listed ? " row-stale" : ""}`;
  return href ? (
    <a className={cls} href={href} target="_blank" rel="noreferrer" title={`Open on ${venueLabel(r.venue)}`}>
      {name}
      {cells}
    </a>
  ) : (
    <div className={cls}>
      {name}
      {cells}
    </div>
  );
}

/** Which venues word this outcome's rules like the one the reader is on (design 24a). */
function RulesNote({ rules, outKey, here, venues }: { rules: RulesOk; outKey: string; here: string; venues: string[] }) {
  if (venues.length < 2) return null;
  const differ = venues.filter((v) => rulesDiffer(rules, outKey, here, v));
  const same = venues.filter((v) => !differ.includes(v));
  const list = (xs: string[]) => {
    const names = xs.map(venueLabel);
    return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  };
  return (
    <div className="rules">
      <span className="best-title">Rules</span>
      {!differ.length ? (
        <span className="muted">Same wording on every venue</span>
      ) : (
        <>
          {same.length > 1 && <span className="muted">Same wording on {list(same)}</span>}
          <span className="yellow">
            {list(differ)} {differ.length > 1 ? "word" : "words"} it differently, read {differ.length > 1 ? "their" : "its"} rules before you trade
          </span>
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Panel />);
