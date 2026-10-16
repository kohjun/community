"use client";
import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { advertisingAllowedLocation } from "@/domain/advertising";
import { useAdSense } from "./adsense-provider";
import { SidebarAd } from "./sidebar-ad";
import { MobileAdSheet } from "./mobile-ad-sheet";

export function SiteAdSurfaces({ children }: { children: ReactNode }) {
  const pathname = usePathname(),
    search = useSearchParams().toString();
  const { config } = useAdSense();
  const allowed = advertisingAllowedLocation(pathname, search);
  const visit = pathname + "?" + search;
  return (
    <div className={"site-ad-layout" + (config.enabled ? " site-ad-layout--adsense" : "")}>
      {children}
      {allowed && <SidebarAd key={visit + ":left"} />}
      {allowed && <SidebarAd key={visit + ":right"} placement="right" />}
      {allowed && !config.enabled && <MobileAdSheet />}
    </div>
  );
}
