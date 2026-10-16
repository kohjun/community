import { isAdSenseClientId } from "@/domain/advertising";

export type AdSensePlacement = "inline" | "left" | "right";
export type AdSenseRuntimeStatus = "disabled" | "loading" | "ready" | "blocked";

export interface AdSenseMeasurement {
  connected: boolean;
  visible: boolean;
  inViewport: boolean;
  width: number;
  height: number;
}

export interface AdSenseRequestNode {
  getAttribute(name: string): string | null;
}

export interface AdSenseQueue {
  push(value: Record<string, never>): unknown;
}

export interface AdSenseBrowserQueue {
  adsbygoogle?: AdSenseQueue;
}

export interface AdSenseVisibilityEnvironment<T extends object> {
  measure(node: T): AdSenseMeasurement;
  observeIntersection(node: T, update: (visible: boolean) => void): (() => void) | null;
  observeResize(node: T, update: () => void): (() => void) | null;
  onViewportChange(update: () => void): () => void;
}

const requestedNodes = new WeakSet<AdSenseRequestNode>();

export function adSenseScriptSource(clientId: string | null): string | null {
  if (!isAdSenseClientId(clientId)) return null;
  return "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + clientId;
}

export function adSenseOriginMatches(
  siteOrigin: string | null,
  browserOrigin: string | null,
): boolean {
  if (!siteOrigin || !browserOrigin) return false;
  try {
    const configured = new URL(siteOrigin);
    const browser = new URL(browserOrigin);
    return (
      configured.protocol === "https:" &&
      !/^(localhost|127\.|0\.0\.0\.0$|\[?::1\]?$)/.test(configured.hostname) &&
      !configured.hostname.endsWith(".localhost") &&
      configured.origin === siteOrigin &&
      browser.origin === browserOrigin &&
      configured.origin === browser.origin
    );
  } catch {
    return false;
  }
}

export function canRequestAdSenseUnit(
  measurement: AdSenseMeasurement,
  placement: AdSensePlacement,
): boolean {
  return (
    measurement.connected &&
    measurement.visible &&
    measurement.inViewport &&
    Number.isFinite(measurement.width) &&
    Number.isFinite(measurement.height) &&
    measurement.width > 0 &&
    measurement.height > 0 &&
    (placement === "inline" || (measurement.width >= 160 && measurement.height >= 600))
  );
}

/** A DOM node is consumed even if Google rejects the request; never refresh or retry that node. */
export function initializeAdSenseUnit(
  node: AdSenseRequestNode,
  browser: AdSenseBrowserQueue,
  measurement: AdSenseMeasurement,
  placement: AdSensePlacement,
): "requested" | "already-requested" | "ineligible" | "blocked" {
  if (requestedNodes.has(node) || node.getAttribute("data-adsbygoogle-status") !== null) {
    return "already-requested";
  }
  if (!canRequestAdSenseUnit(measurement, placement)) return "ineligible";
  requestedNodes.add(node);
  try {
    browser.adsbygoogle ??= [];
    browser.adsbygoogle.push({});
    return "requested";
  } catch {
    return "blocked";
  }
}

/** Observe until the first eligible request; there are no polling or refresh timers. */
export function watchAdSenseVisibility<T extends object>(
  node: T,
  placement: AdSensePlacement,
  environment: AdSenseVisibilityEnvironment<T>,
  onVisible: (measurement: AdSenseMeasurement) => boolean,
): () => void {
  let completed = false;
  let intersecting = false;
  let hasIntersectionObserver = true;
  const disposers: (() => void)[] = [];
  const stop = () => {
    if (completed) return;
    completed = true;
    for (const dispose of disposers.splice(0)) dispose();
  };
  const add = (dispose: (() => void) | null) => {
    if (!dispose) return;
    if (completed) dispose();
    else disposers.push(dispose);
  };
  const check = () => {
    if (completed) return;
    const measurement = environment.measure(node);
    if (hasIntersectionObserver && !intersecting) return;
    if (canRequestAdSenseUnit(measurement, placement) && onVisible(measurement)) stop();
  };
  const intersection = environment.observeIntersection(node, (visible) => {
    intersecting = visible;
    check();
  });
  hasIntersectionObserver = intersection !== null;
  add(intersection);
  add(environment.observeResize(node, check));
  add(environment.onViewportChange(check));
  check();
  return stop;
}

/** A page visit may request each placement once, even when a modal causes its component to remount. */
export function createAdSenseVisitScope() {
  let currentLocation: string | null = null;
  const placements = new Map<AdSensePlacement, AdSenseRequestNode>();
  const navigate = (location: string) => {
    if (location === currentLocation) return;
    currentLocation = location;
    placements.clear();
  };
  return {
    navigate,
    claim(location: string, placement: AdSensePlacement, node: AdSenseRequestNode): boolean {
      navigate(location);
      const previous = placements.get(placement);
      if (previous) return previous === node;
      placements.set(placement, node);
      return true;
    },
  };
}
