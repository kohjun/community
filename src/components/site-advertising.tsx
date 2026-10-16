import type { ReactNode } from "react";
import { Suspense } from "react";
import { getAdvertisingConfiguration } from "@/server/advertising-config";
import { AdSenseProvider } from "./adsense-provider";
import { SiteAdSurfaces } from "./site-ad-surfaces";

/** Public advertising settings are passed explicitly; server credentials stay on the server. */
export function SiteAdvertising({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="site-ad-layout">{children}</div>}>
      <AdSenseProvider config={getAdvertisingConfiguration()}>
        <SiteAdSurfaces>{children}</SiteAdSurfaces>
      </AdSenseProvider>
    </Suspense>
  );
}
