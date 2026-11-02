"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { advertisingAllowedLocation, type AdSenseConfiguration } from "@/domain/advertising";
import {
  adSenseOriginMatches,
  adSenseScriptSource,
  createAdSenseVisitScope,
  type AdSensePlacement,
  type AdSenseRequestNode,
  type AdSenseRuntimeStatus,
} from "@/lib/adsense-runtime";

interface AdSenseContextValue {
  config: AdSenseConfiguration;
  status: AdSenseRuntimeStatus;
  locationKey: string;
  canRequest(): boolean;
  claimRequest(placement: AdSensePlacement, node: AdSenseRequestNode): boolean;
  registerContentGuard(): () => void;
}

const disabledConfiguration: AdSenseConfiguration = {
  enabled: false,
  clientId: null,
  slots: { inline: null, left: null, right: null },
  siteOrigin: null,
};
const AdSenseContext = createContext<AdSenseContextValue>({
  config: disabledConfiguration,
  status: "disabled",
  locationKey: "",
  canRequest: () => false,
  claimRequest: () => false,
  registerContentGuard: () => () => undefined,
});

export function useAdSense(): AdSenseContextValue {
  return useContext(AdSenseContext);
}

function hasVisibleOverlay(): boolean {
  const overlays = document.querySelectorAll<HTMLElement>(
    '[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"])',
  );
  return Array.from(overlays).some((node) => {
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return (
      node.isConnected &&
      node.getClientRects().length > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.visibility !== "collapse" &&
      style.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0
    );
  });
}

/** Private views, editors and empty content opt out of manual ad units. */
export function useAdSenseContentGuard(disabled: boolean): void {
  const { registerContentGuard } = useAdSense();
  useLayoutEffect(() => {
    if (disabled) return registerContentGuard();
  }, [disabled, registerContentGuard]);
}

export function AdSenseProvider({
  config,
  children,
}: {
  config: AdSenseConfiguration;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [browserOrigin, setBrowserOrigin] = useState<string | null>(null);
  const [scriptStatus, setScriptStatus] = useState<"loading" | "ready" | "blocked">("loading");
  const guards = useRef(new Set<symbol>());
  const requestScope = useRef(createAdSenseVisitScope());
  const [guardCount, setGuardCount] = useState(0);
  useEffect(() => {
    setBrowserOrigin(window.location.origin);
  }, []);
  const registerContentGuard = useCallback(() => {
    const token = Symbol();
    guards.current.add(token);
    setGuardCount(guards.current.size);
    return () => {
      guards.current.delete(token);
      setGuardCount(guards.current.size);
    };
  }, []);
  useEffect(() => {
    requestScope.current.navigate(window.location.pathname + window.location.search);
  }, [pathname, search]);
  const source = adSenseScriptSource(config.clientId);
  useEffect(() => {
    if (!source || !adSenseOriginMatches(config.siteOrigin, browserOrigin)) return;
    const script = document.getElementById("sliper-adsense");
    if (!(script instanceof HTMLScriptElement) || script.src !== source) {
      setScriptStatus("blocked");
      return;
    }
    // Google's async snippet permits queue.push before the library finishes loading.
    // This state means ready to enqueue, not that Google approved or filled an ad.
    const failed = () => setScriptStatus("blocked");
    script.addEventListener("error", failed);
    setScriptStatus("ready");
    return () => script.removeEventListener("error", failed);
  }, [source, config.siteOrigin, browserOrigin]);
  const enabled = Boolean(
    config.enabled &&
    source &&
    guardCount === 0 &&
    advertisingAllowedLocation(pathname, search.toString()) &&
    adSenseOriginMatches(config.siteOrigin, browserOrigin),
  );
  const canRequest = () =>
    Boolean(
      enabled &&
      scriptStatus === "ready" &&
      guards.current.size === 0 &&
      typeof window !== "undefined" &&
      adSenseOriginMatches(config.siteOrigin, window.location.origin) &&
      advertisingAllowedLocation(window.location.pathname, window.location.search) &&
      !hasVisibleOverlay(),
    );
  const claimRequest = (placement: AdSensePlacement, node: AdSenseRequestNode) =>
    canRequest() &&
    requestScope.current.claim(window.location.pathname + window.location.search, placement, node);
  const status: AdSenseRuntimeStatus = enabled ? scriptStatus : "disabled";
  return (
    <AdSenseContext.Provider
      value={{
        config,
        status,
        locationKey: pathname + "?" + search.toString(),
        canRequest,
        claimRequest,
        registerContentGuard,
      }}
    >
      {children}
    </AdSenseContext.Provider>
  );
}
