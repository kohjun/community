"use client";
import { useAudience, type Audience } from "@/lib/audience";

const options: { value: Audience; label: string }[] = [
  { value: "participant", label: "참가자" },
  { value: "host", label: "호스트" },
];

/** Switches which menus and home sections lead; every page stays reachable in both modes. */
export function AudienceToggle() {
  const [audience, setAudience] = useAudience();
  return (
    <div className="sl-audience-toggle" role="group" aria-label="보기 모드">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={audience === option.value}
          onClick={() => setAudience(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
