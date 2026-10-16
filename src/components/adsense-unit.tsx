"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useAdSense } from "@/components/adsense-provider";
import { isAdSenseSlotId } from "@/domain/advertising";
import {
  canRequestAdSenseUnit,
  initializeAdSenseUnit,
  watchAdSenseVisibility,
  type AdSenseBrowserQueue,
  type AdSenseMeasurement,
  type AdSensePlacement,
  type AdSenseVisibilityEnvironment,
} from "@/lib/adsense-runtime";

function measureUnit(node: HTMLElement): AdSenseMeasurement {
  const rect = node.getBoundingClientRect();
  const style = window.getComputedStyle(node);
  return {
    connected: node.isConnected,
    visible:
      node.getClientRects().length > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.visibility !== "collapse" &&
      style.opacity !== "0",
    inViewport:
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth,
    width: rect.width,
    height: rect.height,
  };
}

function visibilityEnvironment(): AdSenseVisibilityEnvironment<HTMLElement> {
  return {
    measure: measureUnit,
    observeIntersection: (node, update) => {
      if (typeof IntersectionObserver === "undefined") return null;
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === node) update(entry.isIntersecting);
        }
      });
      observer.observe(node);
      return () => observer.disconnect();
    },
    observeResize: (node, update) => {
      if (typeof ResizeObserver === "undefined") return null;
      const observer = new ResizeObserver(update);
      observer.observe(node);
      return () => observer.disconnect();
    },
    onViewportChange: (update) => {
      window.addEventListener("resize", update, { passive: true });
      window.addEventListener("orientationchange", update, { passive: true });
      window.addEventListener("scroll", update, { passive: true, capture: true });
      return () => {
        window.removeEventListener("resize", update);
        window.removeEventListener("orientationchange", update);
        window.removeEventListener("scroll", update, true);
      };
    },
  };
}

export function AdSenseUnit({
  placement,
  fallback = null,
}: {
  placement: AdSensePlacement;
  fallback?: ReactNode;
}) {
  const { config, status, canRequest, claimRequest } = useAdSense();
  const wrapperRef = useRef<HTMLElement>(null);
  const nodeRef = useRef<HTMLModElement>(null);
  const [mountUnit, setMountUnit] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const slot = config.slots[placement];
  const enabled = Boolean(
    config.enabled &&
    config.clientId &&
    slot &&
    isAdSenseSlotId(slot) &&
    status !== "disabled" &&
    status !== "blocked",
  );
  // An unfilled, hidden ins could be selected by another placement's generic Google queue push.
  // Keep only a placeholder until this placement has a usable size and the script is ready.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !enabled || unavailable || mountUnit || status !== "ready") return;
    return watchAdSenseVisibility(wrapper, placement, visibilityEnvironment(), () => {
      if (!canRequest()) return false;
      setMountUnit(true);
      return true;
    });
  }, [canRequest, enabled, mountUnit, placement, status, unavailable]);
  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node || !enabled || unavailable || !mountUnit || status !== "ready") return;
    if (!canRequest()) return;
    const measurement = measureUnit(node);
    if (!canRequestAdSenseUnit(measurement, placement) || !claimRequest(placement, node)) {
      setUnavailable(true);
      return;
    }
    const result = initializeAdSenseUnit(
      node,
      window as unknown as AdSenseBrowserQueue,
      measurement,
      placement,
    );
    if (result === "blocked" || result === "ineligible") setUnavailable(true);
  }, [canRequest, claimRequest, enabled, mountUnit, placement, status, unavailable]);
  if (!enabled || unavailable) return fallback;
  const inline = placement === "inline";
  const unitStyle = inline
    ? { display: "block", width: "100%", minHeight: 120 }
    : { display: "block", width: 160, height: 600 };
  return (
    <section
      ref={wrapperRef}
      className={"adsense-unit adsense-unit--" + placement}
      aria-label="광고"
    >
      <span className="adsense-unit-label">광고</span>
      {mountUnit ? (
        <ins
          ref={nodeRef}
          className="adsbygoogle"
          style={unitStyle}
          data-ad-client={config.clientId}
          data-ad-slot={slot}
          data-ad-format={inline ? "auto" : undefined}
          data-full-width-responsive={inline ? "true" : undefined}
        />
      ) : (
        <div className="adsense-unit-placeholder" style={unitStyle} aria-hidden="true" />
      )}
    </section>
  );
}
