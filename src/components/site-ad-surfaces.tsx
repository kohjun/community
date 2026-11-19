"use client";
import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { advertisingAllowedLocation } from "@/domain/advertising";
import { useAdSense } from "./adsense-provider";
import { MobileAdSheet } from "./mobile-ad-sheet";

export function SiteAdSurfaces({ children }: { children: ReactNode }) {
  const pathname = usePathname(),
    search = useSearchParams().toString();
  const { config } = useAdSense();
  const allowed = advertisingAllowedLocation(pathname, search);
  return (
    <div className="site-ad-layout">
      {children}
      {allowed && !config.enabled && <MobileAdSheet />}
    </div>
  );
}
