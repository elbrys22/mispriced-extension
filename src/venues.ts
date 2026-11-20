/**
 * The six venues the extension compares, in the order the panel lists its slots (design 24d), and
 * each one's page link as a reader opens it: plain venue links, no referral codes.
 */
import type { VenueLink as IndexVenue } from "@/lib/venuePage";

export type VenueKey = "poly" | "kalshi" | "limitless" | "opinion" | "predictfun" | "hyperliquid";

export const VENUES: { key: VenueKey; label: string; logo: string | null }[] = [
  { key: "poly", label: "Polymarket", logo: "venues/polymarket.svg" },
  { key: "kalshi", label: "Kalshi", logo: "venues/kalshi.svg" },
  { key: "limitless", label: "Limitless", logo: "venues/limitless.svg" },
  { key: "opinion", label: "Opinion", logo: "venues/opinion.svg" },
  { key: "predictfun", label: "predict.fun", logo: "venues/predict.svg" },
  { key: "hyperliquid", label: "Hyperliquid", logo: "venues/hyperliquid.svg" },
];

export const venueLabel = (v: string) => VENUES.find((x) => x.key === v)?.label ?? v;
export const venueLogo = (v: string) => VENUES.find((x) => x.key === v)?.logo ?? null;

/**
 * The page that shows a listing. Kalshi keys a listing by its series page plus the event: the
 * series page alone opens whichever event Kalshi lists first, so the event goes in the path.
 */
export function pageLink(v: IndexVenue): string {
  if (v.venue === "kalshi" && v.ref) {
    const m = /^(https:\/\/kalshi\.com\/markets\/([a-z0-9-]+))\/?$/i.exec(v.url);
    if (m && v.ref.toLowerCase().startsWith(m[2].toLowerCase())) return `${m[1]}/market/${v.ref.toLowerCase()}`;
  }
  return v.url;
}

export const SITE = "https://mispriced.fi";
export const FEEDBACK = "https://x.com/asymmetric_odds";
export const PRIVACY = `${SITE}/privacy`;
/** Where a new version is downloaded (the extension is installed from GitHub, not a store). */
export const RELEASES = "https://github.com/elbrys22/mispriced-extension/releases/latest";
