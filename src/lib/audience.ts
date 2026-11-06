"use client";
import { useSyncExternalStore } from "react";

export type Audience = "participant" | "host";
const KEY = "sliper.audience";
const EVENT = "sliper:audience";
// Fallback for private windows where storage throws; lasts until the page reloads.
let memory: Audience = "participant";

function read(): Audience {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === "host" || stored === "participant" ? stored : memory;
  } catch {
    return memory;
  }
}
function subscribe(onChange: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY) onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", storage);
  };
}

/** Per-device view preference only; it never changes what the server lets a member do. */
export function useAudience(): [Audience, (next: Audience) => void] {
  const audience = useSyncExternalStore(subscribe, read, () => "participant" as const);
  const set = (next: Audience) => {
    memory = next;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Storage unavailable: `memory` carries the choice.
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [audience, set];
}
