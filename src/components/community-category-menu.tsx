"use client";

import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { CATEGORIES, type CategorySlug } from "@/domain/categories";
import { CATEGORY_ICONS } from "./category-icons";
import styles from "./community-category-menu.module.css";

type Category = CategorySlug | "all";
const primarySlugs: readonly CategorySlug[] = ["mind-games", "survival", "dating"];
const primaryCategories = primarySlugs.map((slug) =>
  CATEGORIES.find((item) => item.slug === slug)!,
);
const moreCategories = CATEGORIES.filter((item) => !primarySlugs.includes(item.slug));

export function CommunityCategoryMenu({
  category,
  onSelect,
}: {
  category: Category;
  onSelect: (value: Category) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selectedMore = moreCategories.find((item) => item.slug === category);

  useEffect(() => {
    function closeOnOutsideClick(event: PointerEvent) {
      const details = detailsRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      const details = detailsRef.current;
      if (event.key === "Escape" && details?.open) {
        details.open = false;
        details.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function select(value: Category) {
    if (detailsRef.current) detailsRef.current.open = false;
    onSelect(value);
  }

  return (
    <>
      <nav className={`sl-chips ${styles.desktop}`} aria-label="카테고리">
        <button
          type="button"
          className={category === "all" ? "active" : ""}
          aria-pressed={category === "all"}
          onClick={() => select("all")}
        >
          전체
        </button>
        {CATEGORIES.map((item) => {
          const Icon = CATEGORY_ICONS[item.slug];
          return (
            <button
              type="button"
              key={item.slug}
              className={category === item.slug ? "active" : ""}
              aria-pressed={category === item.slug}
              onClick={() => select(item.slug)}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{item.name}</span>
            </button>
          );
        })}
      </nav>

      <nav className={styles.mobile} aria-label="카테고리">
        <button
          type="button"
          className={category === "all" ? styles.active : ""}
          aria-pressed={category === "all"}
          onClick={() => select("all")}
        >
          전체
        </button>
        {primaryCategories.map((item) => (
          <button
            type="button"
            key={item.slug}
            className={category === item.slug ? styles.active : ""}
            aria-pressed={category === item.slug}
            onClick={() => select(item.slug)}
          >
            {item.name}
          </button>
        ))}
        <details ref={detailsRef} className={styles.more}>
          <summary
            className={selectedMore ? styles.active : ""}
            aria-label={
              selectedMore ? `카테고리 더보기, 현재 ${selectedMore.name}` : "카테고리 더보기"
            }
          >
            <span>{selectedMore?.name ?? "더보기"}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className={styles.menu}>
            {moreCategories.map((item) => (
              <button
                type="button"
                key={item.slug}
                className={category === item.slug ? styles.menuActive : ""}
                aria-pressed={category === item.slug}
                onClick={() => select(item.slug)}
              >
                {item.name}
              </button>
            ))}
          </div>
        </details>
      </nav>
    </>
  );
}
