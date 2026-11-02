"use client";
import { createContext, useContext, type ReactNode } from "react";
import { readSiteOperations } from "@/domain/site-operations";
type Settings = ReturnType<typeof readSiteOperations>;
const Context = createContext<Settings>(readSiteOperations({}));
export function SiteOperationsProvider({
  value,
  children,
}: {
  value: Settings;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useSiteOperations() {
  return useContext(Context);
}
