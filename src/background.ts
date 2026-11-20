/**
 * The service worker: the toolbar badge (design 24f: the gap after fees to the cheapest other
 * venue, for the default amount), the keyboard shortcut that opens the side panel, and closing
 * the panel on tab switches when the reader turned "keep it open" off. Chrome stops this worker
 * when idle, so nothing here keeps state in memory that matters; the badge refreshes on page
 * changes and once a minute for the tab in front.
 */
import { venuePage } from "@/lib/venuePage";
import type { VenueState } from "@/components/market/model";
import { booksOnce, olderThan, resolve } from "./api";
import { saveNotice } from "./notice";
import { BADGE, compare, outcomesOf, pickOutcome } from "./compare";
import { getSettings } from "./settings";
import { putSummary, type Summary } from "./summary";
import { getPick, isPick, putPick, samePage } from "./picks";
import { hasConsent, onConsent } from "./consent";

const VERSION = chrome.runtime.getManifest().version;
const BADGE_BG = "#17694f";
/** The tab may have closed while its books came in: Chrome then refuses, and that's fine. */
const setBadge = (tabId: number, text: string) => void chrome.action.setBadgeText({ tabId, text }).catch(() => {});

function setup() {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  void chrome.action.setBadgeBackgroundColor({ color: BADGE_BG });
  void chrome.action.setBadgeTextColor?.({ color: "#ffffff" });
  void chrome.alarms.create("badge", { periodInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

// The shortcut is a user gesture, so the panel may open from it (it can't open on its own).
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-panel" && tab?.windowId != null) void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
});

type Closable = { close?: (o: { windowId: number }) => Promise<void> };
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const s = await getSettings();
  // Chrome 141+ can close the panel; older versions keep it open.
  if (!s.keepOpen) void (chrome.sidePanel as unknown as Closable).close?.({ windowId })?.catch(() => {});
  void refresh(tabId);
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  // A pick belongs to its page: leaving the page drops it.
  if (change.url)
    void getPick(tabId).then((p) => {
      if (p && !samePage(p.url, change.url!)) void putPick(tabId, null);
    });
  if (tab.active && (change.url || change.status === "complete")) void refresh(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void putSummary(tabId, null);
  void putPick(tabId, null);
});
// The venue page's last outcome click (content.ts), for a panel opened after it.
chrome.runtime.onMessage.addListener((m, sender) => {
  const tabId = sender.tab?.id;
  if (!isPick(m) || tabId == null) return;
  void hasConsent().then((ok) => {
    if (ok) void putPick(tabId, { url: m.url.slice(0, 600), texts: m.texts.slice(0, 12).map((t) => t.slice(0, 400)), at: Date.now() });
  });
});
// Allowed (design 24g): work out the badge for the tabs in front right away.
onConsent(async (allowed) => {
  if (allowed) for (const t of await chrome.tabs.query({ active: true })) if (t.id != null) void refresh(t.id, true);
});
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "badge") return;
  for (const t of await chrome.tabs.query({ active: true })) if (t.id != null) void refresh(t.id, true);
});
chrome.storage.onChanged.addListener(async (_c, area) => {
  if (area !== "sync") return;
  for (const t of await chrome.tabs.query({ active: true })) if (t.id != null) void refresh(t.id, true);
});

// One refresh per tab at a time, and a page change re-checks at once.
const last = new Map<number, { url: string; at: number }>();
const busy = new Set<number>();

async function refresh(tabId: number, force = false) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const url = tab?.url ?? "";
  const page = url ? venuePage(url) : null;
  const s = await getSettings();
  // Nothing goes to our server until the reader allows it.
  if (!page || !(await hasConsent())) {
    setBadge(tabId, "");
    void putSummary(tabId, null);
    return;
  }
  const prev = last.get(tabId);
  if (busy.has(tabId) || (!force && prev?.url === url && Date.now() - prev.at < 50_000)) return;
  busy.add(tabId);
  last.set(tabId, { url, at: Date.now() });
  try {
    const summary = await work(url, s.amount, s.off);
    // The reader may have moved on while the books came in.
    const now = await chrome.tabs.get(tabId).catch(() => null);
    if (now?.url !== url) return;
    void putSummary(tabId, summary?.s ?? null);
    setBadge(tabId, s.badge && summary?.badge ? summary.badge : "");
  } finally {
    busy.delete(tabId);
  }
}

async function work(url: string, amount: number, off: string[]): Promise<{ s: Summary; badge: string } | null> {
  const r = await resolve(url).catch(() => null);
  if (r) saveNotice(r.notice);
  if (!r || olderThan(VERSION, r.ext)) return null;
  const here = r.here.venue;
  if (r.kind === "none") return { s: { kind: "only", title: "", here }, badge: "" };
  const m = r.market;
  if (!m.open) return { s: { kind: "ended", title: m.title, here }, badge: "" };
  const venues = m.venues.filter((v) => v.venue === here || !off.includes(v.venue));
  const books = await Promise.all(venues.map((v) => booksOnce(v)));
  const state: Record<string, VenueState> = {};
  venues.forEach((v, i) => (state[v.venue] = { books: books[i], at: Date.now(), since: 0, failed: !books[i], ms: 0 }));
  const { live, ended } = outcomesOf(venues, state, m.title);
  if (ended) return { s: { kind: "ended", title: m.title, here }, badge: "" };
  const o = pickOutcome(live, r.here.sub);
  const { verdict } = compare(o, venues, here, "yes", amount, null, off);
  const cheaper = verdict?.kind === "cheaper" && verdict.gap >= 0.0005 ? verdict : null;
  return {
    s: { kind: "page", title: m.title, here, best: cheaper?.best ?? (verdict?.kind === "here" ? here : null), gap: cheaper?.gap ?? null },
    badge: cheaper ? BADGE(cheaper.gap) : "",
  };
}
