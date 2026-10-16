import { topicForSlug } from "./topics";

export interface AdSenseConfiguration {
  enabled: boolean;
  clientId: string | null;
  slots: { inline: string | null; left: string | null; right: string | null };
  siteOrigin: string | null;
}

const CLIENT_ID = /^ca-pub-(?!0{16}$)[0-9]{16}$/;
const SLOT_ID = /^(?!0+$)[0-9]{1,20}$/;

export function isAdSenseClientId(value: unknown): value is string {
  return typeof value === "string" && CLIENT_ID.test(value);
}
export function isAdSenseSlotId(value: unknown): value is string {
  return typeof value === "string" && SLOT_ID.test(value);
}

function disabledConfiguration(): AdSenseConfiguration {
  return {
    enabled: false,
    clientId: null,
    slots: { inline: null, left: null, right: null },
    siteOrigin: null,
  };
}

/** Ads are enabled only for the configured public production domain. No DNS requests are made. */
function publicSiteOrigin(value: string | undefined): string | null {
  if (!value || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      hostname.length > 253 ||
      hostname.endsWith(".") ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])$/.test(hostname) ||
      hostname.split(".").some((label) => label.length > 63) ||
      /(?:^|\.)(?:localhost|local|internal|lan|test|invalid|example)$/.test(hostname) ||
      /(?:^|\.)example\.(?:com|net|org)$/.test(hostname)
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Missing and malformed settings never substitute example accounts or request live ads. */
export function readAdvertisingConfiguration(
  env: Record<string, string | undefined>,
): AdSenseConfiguration {
  if (env.NODE_ENV !== "production" || env.LOCAL_DATABASE === "1") return disabledConfiguration();
  const clientId = env.SLIPER_ADSENSE_CLIENT_ID ?? "";
  const siteOrigin = publicSiteOrigin(env.APP_ORIGIN);
  if (!siteOrigin || !CLIENT_ID.test(clientId)) return disabledConfiguration();
  // Site verification can precede approval and live ad activation.
  const verification = { ...disabledConfiguration(), clientId, siteOrigin };
  const inline = env.SLIPER_ADSENSE_SLOT_INLINE ?? "";
  const left = env.SLIPER_ADSENSE_SLOT_LEFT ?? "";
  const right = env.SLIPER_ADSENSE_SLOT_RIGHT ?? "";
  if (
    env.SLIPER_ADSENSE_ENABLED !== "true" ||
    !SLOT_ID.test(inline) ||
    (left !== "" && !SLOT_ID.test(left)) ||
    (right !== "" && !SLOT_ID.test(right))
  )
    return verification;
  return {
    enabled: true,
    clientId,
    slots: { inline, left: left || null, right: right || null },
    siteOrigin,
  };
}

/** Detail, member-only, communication, account and creation screens are excluded by default. */
export function advertisingAllowedPath(pathname: string): boolean {
  if (["/", "/stories", "/lightning", "/archive", "/topics"].includes(pathname)) return true;
  const match = /^\/topics\/([a-z0-9-]+)$/.exec(pathname);
  return !!match?.[1] && topicForSlug(match[1]) !== null;
}

/** URL filters may select a personal library or open a composer within an otherwise public route. */
export function advertisingAllowedLocation(
  pathname: string,
  search: string | URLSearchParams,
): boolean {
  if (!advertisingAllowedPath(pathname)) return false;
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const filters =
    pathname === "/archive"
      ? [
          "kind",
          "category",
          "search",
          "cursor",
          "players",
          "maxDurationMinutes",
          "price",
          "difficulty",
          "environment",
          "maxStaff",
        ]
      : pathname === "/lightning"
        ? ["activityCategory", "tag", "search"]
        : pathname.startsWith("/topics")
          ? ["focus", "storiesPage", "recruitmentPage", "libraryPage"]
          : [
              "category",
              "kind",
              "sort",
              "period",
              "rankingAt",
              "view",
              "page",
              "search",
              "topic",
              "tag",
              "discussionType",
              "focus",
            ];
  const seen = new Set<string>();
  for (const [key, value] of params) {
    if (!filters.includes(key) || seen.has(key)) return false;
    if (key === "view" && !["home", "popular"].includes(value)) return false;
    if (key === "focus" && !["all", "unanswered"].includes(value)) return false;
    seen.add(key);
  }
  return true;
}

export function isAdvertisingOrigin(origin: string, siteOrigin: string | null): boolean {
  return siteOrigin !== null && publicSiteOrigin(origin) === siteOrigin;
}

export function produceAdsTxt(configuration: AdSenseConfiguration): string | null {
  if (
    !configuration.clientId ||
    !CLIENT_ID.test(configuration.clientId) ||
    !configuration.siteOrigin ||
    !publicSiteOrigin(configuration.siteOrigin)
  )
    return null;
  return "google.com, " + configuration.clientId.slice(3) + ", DIRECT, f08c47fec0942fa0\n";
}
