export const RECRUITMENT_LAYOUT_KEY = "sliper:recruitment-layout:v1";
export type RecruitmentLayout = "list" | "card";
export const DEFAULT_RECRUITMENT_LAYOUT: RecruitmentLayout = "card";
interface LayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): LayoutStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readRecruitmentLayout(storage = browserStorage()): RecruitmentLayout {
  try {
    return storage?.getItem(RECRUITMENT_LAYOUT_KEY) === "list"
      ? "list"
      : DEFAULT_RECRUITMENT_LAYOUT;
  } catch {
    return DEFAULT_RECRUITMENT_LAYOUT;
  }
}

export function writeRecruitmentLayout(
  layout: RecruitmentLayout,
  storage = browserStorage(),
): void {
  try {
    storage?.setItem(RECRUITMENT_LAYOUT_KEY, layout);
  } catch {
    // The selected layout remains available in React state when storage is blocked or full.
  }
}
