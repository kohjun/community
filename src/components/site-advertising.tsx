import type { ReactNode } from "react";
import { SidebarAd } from "./sidebar-ad";
import { MobileAdSheet } from "./mobile-ad-sheet";

/** One persistent advertising surface shared by every page. */
export function SiteAdvertising({ children }: { children: ReactNode }) {
  return (
    <div className="site-ad-layout">
      {children}
      <SidebarAd />
      <SidebarAd placement="right" />
      <MobileAdSheet />
    </div>
  );
}
