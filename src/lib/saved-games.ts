"use client";
import { useSyncExternalStore } from "react";
import { GAME_CATALOG, type CatalogGameId } from "@/domain/game-catalog";

const KEY = "sliper.savedGames";
const EVENT = "sliper:saved-games";
const EMPTY: readonly CatalogGameId[] = [];
const known = new Set<string>(GAME_CATALOG.map((game) => game.id));
// Fallback for private windows where storage throws; lasts until the page reloads.
let memory: readonly CatalogGameId[] = EMPTY;
let cachedRaw: string | null = null;
let cached: readonly CatalogGameId[] = EMPTY;

function read(): readonly CatalogGameId[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return memory;
  }
  // Same array identity while storage is unchanged, as useSyncExternalStore requires.
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cached = Array.isArray(parsed)
      ? (parsed.filter((id) => typeof id === "string" && known.has(id)) as CatalogGameId[])
      : EMPTY;
  } catch {
    cached = EMPTY;
  }
  return cached;
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

/** Games saved on this device. Game 찜 is a browsing aid, not account data. */
export function useSavedGames(): [readonly CatalogGameId[], (id: CatalogGameId) => void] {
  const saved = useSyncExternalStore(subscribe, read, () => EMPTY);
  const toggle = (id: CatalogGameId) => {
    const current = read();
    const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    memory = next;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable: `memory` carries the list.
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [saved, toggle];
}
