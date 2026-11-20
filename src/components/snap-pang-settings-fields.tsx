"use client";

import {
  SNAP_PANG_PRESETS,
  SNAP_PANG_PRESET_META,
  SNAP_PANG_ROUND_COUNTS,
  SNAP_PANG_SECONDS,
  type SnapPangPreset,
  type SnapPangSettings,
} from "@/domain/snap-pang";

export function SnapPangSettingsFields({
  value,
  disabled = false,
  onChange,
}: {
  value: SnapPangSettings;
  disabled?: boolean;
  onChange: (next: Partial<SnapPangSettings>) => void;
}) {
  return (
    <>
      <label>
        모임 분위기 프리셋
        <select
          aria-label="스냅 팡 프리셋"
          value={value.preset}
          disabled={disabled}
          onChange={(e) => onChange({ preset: e.target.value as SnapPangPreset })}
        >
          {SNAP_PANG_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {SNAP_PANG_PRESET_META[preset].title} ({SNAP_PANG_PRESET_META[preset].badge})
            </option>
          ))}
        </select>
      </label>
      <p style={{ margin: "4px 0 8px", fontSize: 12, color: "#526174", lineHeight: 1.55 }}>
        {SNAP_PANG_PRESET_META[value.preset].subtitle}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label>
          총 라운드 수
          <select
            aria-label="스냅 팡 라운드 수"
            value={value.rounds}
            disabled={disabled}
            onChange={(e) =>
              onChange({ rounds: Number(e.target.value) as SnapPangSettings["rounds"] })
            }
          >
            {SNAP_PANG_ROUND_COUNTS.map((n) => (
              <option key={n} value={n}>
                {n}라운드
              </option>
            ))}
          </select>
        </label>
        <label>
          라운드 제한시간
          <select
            aria-label="스냅 팡 제한시간"
            value={value.seconds}
            disabled={disabled}
            onChange={(e) =>
              onChange({ seconds: Number(e.target.value) as SnapPangSettings["seconds"] })
            }
          >
            {SNAP_PANG_SECONDS.map((sec) => (
              <option key={sec} value={sec}>
                {sec}초
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
