"use client";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import type { LibraryPayload } from "@/domain/library";
export function LibraryTimer({ rounds }: { rounds: LibraryPayload["rounds"] }) {
  const [index, setIndex] = useState(0),
    [remaining, setRemaining] = useState(rounds[0]?.seconds ?? 0),
    [running, setRunning] = useState(false);
  const end = useRef(0),
    current = rounds[index];
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((end.current - Date.now()) / 1000));
      setRemaining(seconds);
      if (!seconds) setRunning(false);
    }, 250);
    return () => window.clearInterval(timer);
  }, [running]);
  function select(next: number) {
    setRunning(false);
    setIndex(next);
    setRemaining(rounds[next]?.seconds ?? 0);
  }
  function toggle() {
    if (running) {
      setRemaining(Math.max(0, Math.ceil((end.current - Date.now()) / 1000)));
      setRunning(false);
    } else if (remaining) {
      end.current = Date.now() + remaining * 1000;
      setRunning(true);
    }
  }
  if (!current) return null;
  return (
    <section className="marketplace-timer" aria-label="라운드 타이머">
      <div className="marketplace-heading">
        <div>
          <span className="marketplace-kicker">GAME TIMER</span>
          <h2>라운드 타이머</h2>
        </div>
        <select
          aria-label="진행할 라운드"
          value={index}
          onChange={(e) => select(Number(e.target.value))}
        >
          {rounds.map((r, i) => (
            <option key={i} value={i}>
              {i + 1}. {r.name}
            </option>
          ))}
        </select>
      </div>
      <p>
        {current.name} · {index + 1} / {rounds.length} 라운드
      </p>
      <div className="marketplace-timer-display" role="timer" aria-label={`${remaining}초 남음`}>
        {String(Math.floor(remaining / 60)).padStart(2, "0")}
        <span>:</span>
        {String(remaining % 60).padStart(2, "0")}
      </div>
      <div className="marketplace-actions">
        <button
          className="participation-primary"
          type="button"
          onClick={toggle}
          disabled={!remaining}
        >
          {running ? <Pause size={16} /> : <Play size={16} />} {running ? "일시정지" : "시작"}
        </button>
        <button className="participation-secondary" type="button" onClick={() => select(index)}>
          <RotateCcw size={16} />
          초기화
        </button>
        <button
          className="participation-secondary"
          type="button"
          onClick={() => select(index + 1)}
          disabled={index >= rounds.length - 1}
        >
          <SkipForward size={16} />
          다음 라운드
        </button>
      </div>
      <p aria-live="polite">
        {remaining === 0
          ? "라운드가 끝났어요. 다음 미션을 안내해주세요."
          : "잠시 자리를 비워도 실제 경과 시간을 기준으로 표시해요."}
      </p>
    </section>
  );
}
export function LibraryChecklist({ materials }: { materials: string[] }) {
  const [checked, setChecked] = useState<number[]>([]);
  return (
    <section className="marketplace-section">
      <div className="marketplace-heading">
        <h2>준비물 체크리스트</h2>
        <span>
          {checked.length} / {materials.length}
        </span>
      </div>
      <div className="marketplace-checklist">
        {materials.map((item, index) => (
          <label key={index}>
            <input
              type="checkbox"
              checked={checked.includes(index)}
              onChange={(e) =>
                setChecked((previous) =>
                  e.target.checked ? [...previous, index] : previous.filter((v) => v !== index),
                )
              }
            />
            <span>{item}</span>
          </label>
        ))}
      </div>
      {!materials.length && <p>추가 준비물이 없어요.</p>}
    </section>
  );
}
