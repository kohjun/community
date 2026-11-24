"use client";
import { useId } from "react";
import { Check } from "lucide-react";
import styles from "./creative-games.module.css";

export type GameModeCard<T extends string = string> = {
  id: T;
  emoji: string;
  title: string;
  badge: string;
  description: string;
  steps: readonly { title: string; detail: string }[];
};

/** 은/는 by the last syllable's final consonant (우리 사진은 · 숫자 맞히기는). */
function topicParticle(word: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? "은" : "는";
}

/**
 * Shared mode chooser for the web games: one card per mode (what it is + its flow at a glance),
 * then the chosen mode's steps spelled out, so hosts know exactly what players will do.
 */
export function GameModePicker<T extends string>({
  legend,
  modes,
  value,
  onChange,
  note,
  disabled = false,
}: {
  legend: string;
  modes: readonly GameModeCard<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Short scoring or rule summary shown beside the chosen mode's steps. */
  note: string;
  disabled?: boolean;
}) {
  const uid = useId();
  const mode = modes.find((m) => m.id === value) ?? modes[0]!;
  return (
    <div className={styles.form}>
      <fieldset className={styles.modeFieldset} disabled={disabled}>
        <legend>{legend}</legend>
        <div className={styles.drawModes}>
          {modes.map((m) => {
            const selected = m.id === value;
            return (
              <label
                className={styles.drawMode}
                key={m.id}
                htmlFor={`${uid}-${m.id}`}
                data-selected={selected}
                data-disabled={disabled}
              >
                <input
                  id={`${uid}-${m.id}`}
                  name={`${uid}-mode`}
                  type="radio"
                  value={m.id}
                  checked={selected}
                  className={styles.hiddenLabel}
                  onChange={() => onChange(m.id)}
                />
                <span className={styles.drawModeEmoji} aria-hidden="true">
                  {m.emoji}
                </span>
                <span className={styles.drawModeBody}>
                  <span className={styles.drawModeTitle}>
                    <strong>{m.title}</strong>
                    <em>{m.badge}</em>
                  </span>
                  <small>{m.description}</small>
                  <span className={styles.drawModeFlow} aria-label="진행 순서">
                    {m.steps.map((step) => (
                      <i key={step.title}>{step.title}</i>
                    ))}
                  </span>
                </span>
                <Check className={styles.modeCheck} size={18} aria-hidden="true" />
              </label>
            );
          })}
        </div>
      </fieldset>
      <GameModePlan mode={mode} note={note} />
    </div>
  );
}

/** The chosen mode's steps, spelled out. Also used alone by games without modes. */
export function GameModePlan({
  mode,
  note,
}: {
  mode: Pick<GameModeCard, "emoji" | "title" | "steps">;
  note: string;
}) {
  return (
    <section className={styles.drawPlan} aria-label={`${mode.title} 진행 순서`}>
      <header>
        <strong>
          {mode.emoji} {mode.title}
          {topicParticle(mode.title)} 이렇게 진행돼요
        </strong>
        <span>{note}</span>
      </header>
      <ol>
        {mode.steps.map((step, index) => (
          <li key={step.title}>
            <b>{index + 1}</b>
            <div>
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
