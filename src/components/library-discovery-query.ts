import { CATEGORIES } from "@/domain/categories";
import type { LibraryKind } from "@/domain/library";

export interface LibraryFilterState {
  kind: LibraryKind | "";
  search: string;
  category: string;
  mine: boolean;
  players: string;
  maxDurationMinutes: string;
  price: "" | "free" | "paid";
  used: boolean;
  difficulty: "" | "easy" | "standard" | "advanced";
  environment: "" | "indoor" | "outdoor" | "mixed";
  maxStaff: string;
}

export const LIBRARY_FILTER_KEYS = [
  "kind",
  "search",
  "category",
  "mine",
  "players",
  "maxDurationMinutes",
  "price",
  "used",
  "difficulty",
  "environment",
  "maxStaff",
  "cursor",
] as const;

export function emptyLibraryFilters(kind: LibraryKind | "" = ""): LibraryFilterState {
  return {
    kind,
    search: "",
    category: "",
    mine: false,
    players: "",
    maxDurationMinutes: "",
    price: "",
    used: false,
    difficulty: "",
    environment: "",
    maxStaff: "",
  };
}

export function libraryFiltersFromParams(params: URLSearchParams): LibraryFilterState {
  const integer = (key: string, min: number, max: number) => {
    const raw = params.get(key);
    if (!raw || !/^\d+$/.test(raw)) return "";
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= min && value <= max ? String(value) : "";
  };
  const choice = <T extends string>(key: string, choices: readonly T[]): T | "" => {
    const value = params.get(key);
    return choices.find((option) => option === value) ?? "";
  };
  return {
    kind: choice("kind", ["rulebook", "template"] as const),
    search: (params.get("search") ?? "").trim().slice(0, 100),
    category: CATEGORIES.find((category) => category.slug === params.get("category"))?.slug ?? "",
    mine: params.get("mine") === "true",
    players: integer("players", 1, 5000),
    maxDurationMinutes: integer("maxDurationMinutes", 5, 1440),
    price: choice("price", ["free", "paid"] as const),
    used: params.get("used") === "true",
    difficulty: choice("difficulty", ["easy", "standard", "advanced"] as const),
    environment: choice("environment", ["indoor", "outdoor", "mixed"] as const),
    maxStaff: integer("maxStaff", 0, 100),
  };
}

export function libraryCursorFromParams(params: URLSearchParams): string | undefined {
  const cursor = params.get("cursor");
  return cursor && cursor.length <= 1024 ? cursor : undefined;
}

export function libraryFilterParams(value: LibraryFilterState, cursor?: string): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, field] of Object.entries(value)) {
    if (field === true) params.set(key, "true");
    else if (typeof field === "string" && field.trim()) params.set(key, field.trim());
  }
  if (cursor) params.set("cursor", cursor);
  return params;
}

export function libraryFilterUrl(url: URL, value: LibraryFilterState, cursor?: string): string {
  const next = new URL(url);
  for (const key of LIBRARY_FILTER_KEYS) next.searchParams.delete(key);
  libraryFilterParams(value, cursor).forEach((field, key) => next.searchParams.set(key, field));
  return next.pathname + next.search + next.hash;
}
