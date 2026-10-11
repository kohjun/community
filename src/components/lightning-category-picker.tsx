"use client";

import { useId } from "react";
import {
  Camera,
  Check,
  Dumbbell,
  FerrisWheel,
  Gamepad2,
  Music2,
  Palette,
  PawPrint,
  Sparkles,
  Ticket,
  Trees,
  Users,
  Utensils,
  Wine,
  type LucideIcon,
} from "lucide-react";
import { LIGHTNING_CATEGORIES, type LightningCategorySlug } from "@/domain/lightning-categories";

const CATEGORY_ICONS: Record<LightningCategorySlug, LucideIcon> = {
  "food-cafe": Utensils,
  drinks: Wine,
  games: Gamepad2,
  culture: Ticket,
  sports: Dumbbell,
  outdoors: Trees,
  crafting: Palette,
  music: Music2,
  photography: Camera,
  pets: PawPrint,
  attractions: FerrisWheel,
  social: Users,
  other: Sparkles,
};

export function LightningCategoryIcon({
  slug,
  size = 20,
}: {
  slug: LightningCategorySlug | null | undefined;
  size?: number;
}) {
  const Icon = CATEGORY_ICONS[slug ?? "other"];
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export interface LightningCategoryPickerProps {
  value: LightningCategorySlug | "";
  onChange: (value: LightningCategorySlug | "") => void;
  variant?: "browse" | "form";
  disabled?: boolean;
}

export function LightningCategoryPicker({
  value,
  onChange,
  variant = "browse",
  disabled = false,
}: LightningCategoryPickerProps) {
  const headingId = useId();

  if (variant === "form") {
    return (
      <fieldset
        className="lightning-category-picker lightning-category-picker--form"
        disabled={disabled}
      >
        <legend className="lightning-category-legend">
          활동 카테고리
          <span className="lightning-category-required">필수</span>
        </legend>
        <div className="lightning-category-grid">
          {LIGHTNING_CATEGORIES.map((category) => (
            <label
              key={category.slug}
              className={
                "lightning-category-radio" +
                (category.slug === "other" ? " lightning-category-radio--other" : "")
              }
            >
              <input
                type="radio"
                name="activityCategory"
                value={category.slug}
                checked={value === category.slug}
                onChange={() => onChange(category.slug)}
                required
              />
              <span className="lightning-category-tile">
                <span className="lightning-category-icon">
                  <LightningCategoryIcon slug={category.slug} size={19} />
                </span>
                <span className="lightning-category-label">{category.name}</span>
                {value === category.slug && (
                  <Check className="lightning-category-check" size={13} aria-hidden="true" />
                )}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <section
      className="lightning-category-picker lightning-category-picker--browse"
      aria-labelledby={headingId}
    >
      <div className="lightning-category-heading">
        <div>
          <h2 id={headingId}>어떤 활동을 찾나요?</h2>
          <p>함께 즐기고 싶은 활동을 골라보세요.</p>
        </div>
        <button
          type="button"
          className="lightning-category-reset"
          aria-pressed={value === ""}
          onClick={() => onChange("")}
          disabled={disabled}
        >
          전체
        </button>
      </div>
      <div className="lightning-category-grid" role="group" aria-labelledby={headingId}>
        {LIGHTNING_CATEGORIES.map((category) => (
          <button
            key={category.slug}
            type="button"
            className={
              "lightning-category-tile" +
              (category.slug === "other" ? " lightning-category-tile--other" : "")
            }
            aria-pressed={value === category.slug}
            onClick={() => onChange(category.slug)}
            disabled={disabled}
          >
            <span className="lightning-category-icon">
              <LightningCategoryIcon slug={category.slug} size={22} />
            </span>
            <span className="lightning-category-label">{category.name}</span>
            {value === category.slug && (
              <Check className="lightning-category-check" size={14} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
