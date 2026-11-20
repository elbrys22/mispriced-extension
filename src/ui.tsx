/** Pieces the side panel and the popup share (design 24d–24f). */
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { giveConsent, hasConsent, onConsent } from "./consent";
import { FEEDBACK, PRIVACY, venueLabel, venueLogo } from "./venues";
import type { Notice } from "./notice";

/** Whether sending venue page links is allowed (consent.ts); null while it's being read. */
export function useConsent(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    void hasConsent().then(setAllowed);
    return onConsent(setAllowed);
  }, []);
  return allowed;
}

/** What "Allow" covers (design 24g): the panel's card and the popup's page block. */
export function ConsentBody() {
  return (
    <>
      <span className="card-b">
        To find this market on the other venues, Mispriced sends the link of the venue page you're on to our server. Only market pages on the six venues, and
        nothing about you, your account or other sites.
      </span>
      <span className="card-b">On Polymarket, Limitless, Opinion and predict.fun it also reads which outcome you click, to follow it. That stays in your browser.</span>
      <button type="button" className="btn-primary" onClick={() => void giveConsent()}>
        Allow and show prices
      </button>
      <a className="privacy-link" href={PRIVACY} target="_blank" rel="noreferrer">
        Privacy policy ↗
      </a>
    </>
  );
}

/** Parts of a meta line with a dimmed "|" between them. */
export function Parts({ items }: { items: ReactNode[] }) {
  return (
    <>
      {items.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="sep"> | </span>}
          {it}
        </Fragment>
      ))}
    </>
  );
}

/** The server's message (src/notice.ts, design 24e/24f): icon, plain text, an optional link to our own sites, close. */
export function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const warn = notice.kind === "warning";
  return (
    <div className={`notice ${notice.kind}`} role={warn ? "alert" : "status"}>
      <span className="notice-i" aria-hidden="true">
        {warn ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3.5 2.5 20h19z" />
            <path d="M12 10v4.5M12 17.2v.3" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 7.5v.5" />
          </svg>
        )}
      </span>
      <span className="notice-t">
        {notice.text}
        {notice.link && (
          <>
            {"\u00a0 "}
            <a href={notice.link} target="_blank" rel="noreferrer">
              {notice.label ?? "Read more"} ↗
            </a>
          </>
        )}
      </span>
      <button type="button" className="notice-x" onClick={onClose} aria-label="Close message">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

/** Follow us on X (design 24d–24f): under the footer's main button, or beside it in the popup. */
export function FollowX({ label = "Follow @asymmetric_odds" }: { label?: string }) {
  return (
    <a className="btn-x" href={FEEDBACK} target="_blank" rel="noreferrer" aria-label="Follow @asymmetric_odds on X">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
      {label}
    </a>
  );
}

/** A venue's mark; Hyperliquid has none of its own in the design and shows an "H" tile. */
export function Logo({ venue, size = 16 }: { venue: string; size?: number }) {
  const src = venueLogo(venue);
  return src ? (
    <img className="logo" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />
  ) : (
    <span className="logo logo-h" style={{ width: size, height: size, fontSize: Math.round(size * 0.56) }}>
      H
    </span>
  );
}

export function VenueChip({ venue }: { venue: string }) {
  return (
    <span className="chip">
      <Logo venue={venue} size={12} />
      {venueLabel(venue)}
    </span>
  );
}

export function Seg<T extends string | number>({ items, value, onPick, label, wide }: { items: [T, string][]; value: T; onPick: (v: T) => void; label: string; wide?: boolean }) {
  return (
    <span role="group" aria-label={label} className={wide ? "seg seg-wide" : "seg"}>
      {items.map(([k, l]) => (
        <button key={String(k)} type="button" aria-pressed={k === value} className={k === value ? "on" : ""} onClick={() => onPick(k)}>
          {l}
        </button>
      ))}
    </span>
  );
}

/** Whole dollars, grouped as typed ("1,500"). */
export const amountText = (n: number) => (n ? n.toLocaleString("en-US") : "");
export const parseAmount = (s: string, max: number) => Math.min(max, Number(s.replace(/[^0-9]/g, "")) || 0);
