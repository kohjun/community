"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const GameRoundActionsTarget = createContext<HTMLElement | null>(null);

/** Keeps the same native controls in the mobile action bar and inline elsewhere. */
export function GameRoundActions({ children }: { children: ReactNode }) {
  const target = useContext(GameRoundActionsTarget);
  return target ? createPortal(children, target) : children;
}

export function GameRoundDetails({
  label,
  className,
  children,
}: {
  label: string;
  className: string | undefined;
  children: ReactNode;
}) {
  const compact = useContext(GameRoundActionsTarget) !== null;
  return (
    <details className={className} open={!compact}>
      <summary>{label}</summary>
      {children}
    </details>
  );
}
