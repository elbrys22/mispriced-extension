/**
 * The popup from the toolbar icon (design 24f): what the badge found on this page, the button
 * that opens the side panel, and the settings. Chrome caps a popup at 600px tall.
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { venuePage } from "@/lib/venuePage";
import { C } from "./compare";
import { DEFAULTS, getSettings, MAX_AMOUNT, onSettings, setSettings, type Settings } from "./settings";
import { useNotice } from "./notice";
import { getSummary, type Summary } from "./summary";
import { amountText, ConsentBody, FollowX, Logo, NoticeBar, parseAmount, Parts, Seg, useConsent } from "./ui";
import { SITE, VENUES, venueLabel } from "./venues";

function Check({ on, label, onPick, children }: { on: boolean; label: string; onPick: () => void; children?: React.ReactNode }) {
  return (
    <button type="button" className="check" aria-pressed={on} onClick={onPick}>
      <span className={on ? "box on" : "box"}>{on ? "✓" : ""}</span>
      {children}
      <span>{label}</span>
    </button>
  );
}

function Popup() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [sum, setSum] = useState<Summary | null>(null);
  const { notice, close } = useNotice();
  const [shortcut, setShortcut] = useState("");
  const [amtTxt, setAmtTxt] = useState<string | null>(null);
  useEffect(() => {
    void getSettings().then(setS);
    void chrome.tabs.query({ active: true, currentWindow: true }).then(async ([t]) => {
      setTab(t ?? null);
      if (t?.id != null) setSum(await getSummary(t.id));
    });
    void chrome.commands.getAll().then((cs) => setShortcut(cs.find((c) => c.name === "open-panel")?.shortcut ?? ""));
    return onSettings(setS);
  }, []);

  const consent = useConsent();
  const page = tab?.url ? venuePage(tab.url) : null;
  const title = sum && sum.title ? sum.title : (tab?.title ?? "").replace(/\s*[|\-–—·]\s*(Polymarket|Kalshi|Limitless|Opinion|predict\.fun|Hyperliquid)\b.*$/i, "");
  const openPanel = () => {
    if (tab?.windowId == null) return;
    void chrome.sidePanel.open({ windowId: tab.windowId }).then(() => window.close(), () => {});
  };
  const put = (p: Partial<Settings>) => {
    setS({ ...s, ...p });
    void setSettings(p);
  };

  return (
    <div className="popup">
      <header className="head">
        <span className="wordmark">mispriced.</span>
        <span className="ago">6 venues</span>
      </header>
      {notice && <NoticeBar notice={notice} onClose={close} />}

      {consent === false ? (
        <section className="pop-page">
          <span className="label">Allow price lookups</span>
          <ConsentBody />
        </section>
      ) : (
      <section className="pop-page">
        <span className="label">On this page</span>
        {page ? (
          <>
            <span className="pop-title">{title || "…"}</span>
            <PageLine sum={sum} />
          </>
        ) : (
          <span className="pop-title muted">Not a market page. Open a market on any of the six venues.</span>
        )}
        <button type="button" className="btn-blue" onClick={openPanel}>
          Open side panel
        </button>
        {shortcut && (
          <span className="shortcut">
            or press <kbd>{shortcut}</kbd>
          </span>
        )}
      </section>
      )}

      <section className="pop-settings">
        <span className="label">Settings</span>
        <Check on={s.keepOpen} label="Keep the panel open when I switch tabs" onPick={() => put({ keepOpen: !s.keepOpen })} />
        <Check on={s.badge} label="Show the price gap on the icon" onPick={() => put({ badge: !s.badge })} />
        <div className="pop-amount">
          <span>Default amount</span>
          <div className="amount-row">
            <label className="amount">
              <span>$</span>
              <input
                value={amtTxt ?? amountText(s.amount)}
                onChange={(e) => {
                  const n = parseAmount(e.target.value, MAX_AMOUNT);
                  setAmtTxt(amountText(n));
                  if (n > 0) put({ amount: n });
                }}
                onBlur={() => setAmtTxt(null)}
                aria-label="Default amount in dollars"
                placeholder="Amount"
                inputMode="numeric"
              />
            </label>
            <Seg
              label="Quick amounts"
              items={[[100, "$100"], [500, "$500"], [1000, "$1K"]]}
              value={s.amount}
              onPick={(n) => {
                setAmtTxt(null);
                put({ amount: n });
              }}
            />
          </div>
        </div>
      </section>

      <section className="pop-venues">
        <span className="label">Compare these venues</span>
        <div className="venue-grid">
          {VENUES.map((v) => {
            const on = !s.off.includes(v.key);
            return (
              <Check key={v.key} on={on} label={v.label} onPick={() => put({ off: on ? [...s.off, v.key] : s.off.filter((x) => x !== v.key) })}>
                <Logo venue={v.key} size={14} />
              </Check>
            );
          })}
        </div>
      </section>

      <footer className="foot">
        <div className="foot-row">
          <a className="btn-ghost" href={SITE} target="_blank" rel="noreferrer">
            Open mispriced.fi ↗
          </a>
          <FollowX label="Follow on X" />
        </div>
        <span className="fine">
          <Parts items={["Compares prices only", "no trading from the extension"]} />
        </span>
      </footer>
    </div>
  );
}

function PageLine({ sum }: { sum: Summary | null }) {
  if (!sum) return <span className="pop-line muted">Checking prices…</span>;
  if (sum.kind === "only") return <span className="pop-line muted">Only on {venueLabel(sum.here)} so far</span>;
  if (sum.kind === "ended") return <span className="pop-line muted">This market has ended</span>;
  if (sum.best && sum.gap != null)
    return (
      <span className="pop-line">
        <Logo venue={sum.best} size={14} />
        <span>
          {venueLabel(sum.best)} is <span className="green">{C(sum.gap)} cheaper</span> after fees
        </span>
      </span>
    );
  if (sum.best === sum.here) return <span className="pop-line muted">Best price is here, after fees</span>;
  return <span className="pop-line muted">Open the side panel to compare</span>;
}

createRoot(document.getElementById("root")!).render(<Popup />);
