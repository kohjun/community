"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { ArrowDown, ArrowUp, Clock3, GripVertical, Send, SkipForward } from "lucide-react";
import type { GameRoomView } from "@/domain/game-room";
import { TEMPERATURE_MODE_INFO, type TemperatureView } from "@/domain/temperature-game";
import { CreativeScores, CreativeWinners } from "./creative-game-common";
import cg from "./creative-games.module.css";
import styles from "./temperature-game-stage.module.css";

type Send = (action: Record<string, unknown>, host?: boolean) => void;
type Task = { emoji: string; title: string; detail: string; tone: "act" | "wait" | "watch" };

/** Cool blue at 0 → purple → warm red at 100, so a number reads as a temperature at a glance. */
const heat = (value: number) => `hsl(${Math.round(220 + value * 1.4)} 78% 52%)`;
const heatStyle = (value: number) => ({ "--heat": heat(value) }) as CSSProperties;

function Scale({
  low,
  high,
  markers = [],
}: {
  low: string;
  high: string;
  markers?: { value: number; label: string; main?: boolean }[];
}) {
  return (
    <div className={styles.scale}>
      <div className={styles.scaleBar} aria-hidden={markers.length === 0}>
        {markers.map((marker, index) => (
          <span
            key={`${marker.label}-${index}`}
            className={marker.main ? styles.markerMain : styles.marker}
            style={{ left: `${marker.value}%`, ...heatStyle(marker.value) }}
            title={`${marker.label} ${marker.value}`}
          >
            {marker.main ? marker.value : marker.label.slice(0, 1)}
          </span>
        ))}
      </div>
      <div className={styles.scaleLabels}>
        <span>
          <b>0</b> {low}
        </span>
        <span>
          {high} <b>100</b>
        </span>
      </div>
    </div>
  );
}

function NumberPicker({
  value,
  onChange,
  disabled,
  low,
  high,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
  low: string;
  high: string;
}) {
  const set = (next: number) => onChange(Math.max(0, Math.min(100, next)));
  return (
    <div className={styles.picker} style={heatStyle(value)}>
      <output className={styles.pickerValue} aria-live="polite">
        {value}
        <small>도</small>
      </output>
      <input
        className={styles.range}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        aria-label="숫자 고르기"
        aria-valuetext={`${value}도`}
        onChange={(event) => set(Number(event.target.value))}
      />
      <div className={styles.scaleLabels}>
        <span>
          <b>0</b> {low}
        </span>
        <span>
          {high} <b>100</b>
        </span>
      </div>
      <div className={styles.steppers} role="group" aria-label="숫자 미세 조정">
        {[-10, -1, 1, 10].map((step) => (
          <button
            key={step}
            type="button"
            disabled={disabled}
            aria-label={`${step > 0 ? "+" : ""}${step}`}
            onClick={() => set(value + step)}
          >
            {step > 0 ? `+${step}` : step}
          </button>
        ))}
      </div>
    </div>
  );
}

function OrderCards({
  game,
  viewerId,
  disabled,
  onSubmit,
}: {
  game: TemperatureView;
  viewerId: string;
  disabled: boolean;
  onSubmit: (order: string[]) => void;
}) {
  const [draft, setDraft] = useState(() => game.situations.map((item) => item.id));
  const [announcement, setAnnouncement] = useState("");
  const drag = useRef<{ id: string; lastTarget: string | null } | null>(null);
  const order = game.myOrder ?? draft;
  const situations = new Map(game.situations.map((item) => [item.id, item.text]));
  const names = new Map(game.roster.map((person) => [person.id, person.nickname]));
  const locked = disabled || !!game.myOrder;
  function move(id: string, to: number) {
    if (locked) return;
    const from = draft.indexOf(id);
    if (from < 0 || to < 0 || to >= draft.length || from === to) return;
    const next = [...draft];
    next.splice(from, 1);
    next.splice(to, 0, id);
    setDraft(next);
    setAnnouncement(`${names.get(id) ?? "상황"} 카드를 ${to + 1}번째로 옮겼어요.`);
  }
  function handleDrag(event: PointerEvent<HTMLSpanElement>) {
    if (!drag.current || locked) return;
    if (event.clientY < 64) window.scrollBy(0, -24);
    else if (event.clientY > window.innerHeight - 64) window.scrollBy(0, 24);
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-temperature-card]")?.dataset.temperatureCard;
    if (!target || target === drag.current.id || target === drag.current.lastTarget) return;
    drag.current.lastTarget = target;
    move(drag.current.id, draft.indexOf(target));
  }

  return (
    <form
      className={styles.orderForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (!locked) onSubmit(draft);
      }}
    >
      <p className={styles.axis} data-end="low">
        ⬆ 낮은 숫자 (0에 가까움)
      </p>
      <ol className={styles.orderCards} aria-label="숫자가 낮은 순서부터 배치">
        {order.map((id, index) => (
          <li
            key={id}
            data-temperature-card={id}
            className={styles.orderCard}
            data-mine={id === viewerId}
          >
            <span className={styles.position} aria-label={`${index + 1}번째`}>
              {index + 1}
            </span>
            <div>
              <strong>
                {names.get(id)}
                {id === viewerId && <small>내 상황</small>}
              </strong>
              <p>{situations.get(id)}</p>
            </div>
            {!game.myOrder && (
              <div className={styles.moveTools}>
                <span
                  className={styles.grip}
                  aria-hidden="true"
                  onPointerDown={(event) => {
                    if (locked || event.button !== 0) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = { id, lastTarget: null };
                  }}
                  onPointerMove={handleDrag}
                  onLostPointerCapture={() => {
                    drag.current = null;
                  }}
                >
                  <GripVertical size={18} />
                </span>
                <button
                  type="button"
                  aria-label={`${names.get(id)} 카드 위로`}
                  disabled={locked || index === 0}
                  onClick={() => move(id, index - 1)}
                >
                  <ArrowUp size={17} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`${names.get(id)} 카드 아래로`}
                  disabled={locked || index === order.length - 1}
                  onClick={() => move(id, index + 1)}
                >
                  <ArrowDown size={17} aria-hidden="true" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      <p className={styles.axis} data-end="high">
        ⬇ 높은 숫자 (100에 가까움)
      </p>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {!game.myOrder && (
        <div className={cg.dgDock}>
          <button className={cg.button} type="submit" disabled={locked}>
            <Send size={16} aria-hidden="true" /> 이 순서로 제출
          </button>
        </div>
      )}
    </form>
  );
}

function Review({
  game,
  name,
  me,
}: {
  game: TemperatureView;
  name: (id: string | null) => string;
  me: string | null;
}) {
  const result = game.result;
  if (!result) return null;
  if (result.mode === "basic") {
    if (result.skipped) return null;
    const guesses = [...result.guesses].sort((a, b) => a.distance - b.distance);
    return (
      <section className={styles.review} aria-label="이번 결과">
        {result.answer !== null && game.topic && (
          <Scale
            low={game.topic.low}
            high={game.topic.high}
            markers={[
              ...guesses.map((entry) => ({ value: entry.value, label: name(entry.id) })),
              { value: result.answer, label: "정답", main: true },
            ]}
          />
        )}
        {guesses.length === 0 ? (
          <p className={styles.empty}>이번 차례에 제출한 숫자가 없어요.</p>
        ) : (
          <ol className={styles.rows}>
            {guesses.map((entry) => (
              <li key={entry.id} data-self={entry.id === me} data-win={entry.points > 0}>
                <b>{entry.points ? "🥇" : "·"}</b>
                <span>
                  <strong>
                    {name(entry.id)}
                    {entry.id === me ? " (나)" : ""}
                  </strong>
                  <small>
                    {entry.value}도 · 차이 {entry.distance}
                  </small>
                </span>
                <em>+{entry.points}점</em>
              </li>
            ))}
          </ol>
        )}
      </section>
    );
  }
  const orders = [...result.orders].sort((a, b) => b.correctPairs - a.correctPairs);
  return (
    <section className={styles.review} aria-label="이번 결과">
      <p className={styles.axis} data-end="low">
        ⬆ 실제로 낮은 숫자
      </p>
      <ol className={styles.truth}>
        {result.situations.map((situation) => (
          <li key={situation.id} style={heatStyle(situation.value)}>
            <b>{situation.value}</b>
            <span>
              <strong>{name(situation.id)}</strong>
              <p>{situation.text}</p>
            </span>
          </li>
        ))}
      </ol>
      {result.comparablePairs === 0 ? (
        <p className={styles.empty}>
          모두 같은 숫자를 골라 비교할 수 없어서 이번 라운드는 0점이에요.
        </p>
      ) : orders.length === 0 ? (
        <p className={styles.empty}>이번 라운드에 제출한 순서가 없어요.</p>
      ) : (
        <ol className={styles.rows}>
          {orders.map((entry) => (
            <li key={entry.id} data-self={entry.id === me} data-win={entry.points > 0}>
              <b>{entry.points ? "🥇" : "·"}</b>
              <span>
                <strong>
                  {name(entry.id)}
                  {entry.id === me ? " (나)" : ""}
                </strong>
                <small>
                  {entry.correctPairs}/{result.comparablePairs}쌍 맞힘 ·{" "}
                  {entry.order.map(name).join(" → ")}
                </small>
              </span>
              <em>+{entry.points}점</em>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function TemperatureGameStage({
  room,
  game,
  busy,
  onAction,
  onRefresh,
}: {
  room: GameRoomView;
  game: TemperatureView;
  busy: boolean;
  onAction: Send;
  onRefresh: () => void;
}) {
  const [number, setNumber] = useState(50);
  const [text, setText] = useState("");
  const [seconds, setSeconds] = useState(() =>
    Math.max(0, Math.ceil(((game.endsAt ?? game.serverNow) - game.serverNow) / 1000)),
  );
  const [toast, setToast] = useState<{ id: string; text: string } | null>(null);
  const refreshed = useRef<number | null>(null);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    if (game.endsAt === null) return;
    const deadline = game.endsAt;
    const offset = game.serverNow - Date.now();
    function tick() {
      const left = Math.max(0, Math.ceil((deadline - Date.now() - offset) / 1000));
      setSeconds(left);
      if (left === 0 && refreshed.current !== deadline) {
        refreshed.current = deadline;
        refresh.current();
      }
    }
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [game.endsAt, game.serverNow]);

  const me = room.viewer.id;
  const mode = TEMPERATURE_MODE_INFO[game.settings.mode];
  const basic = game.settings.mode === "basic";
  const playing = !!me && game.roster.some((player) => player.id === me);
  const isClue = !!me && me === game.clueId;
  const finished = game.stage === "result" || game.stage === "aborted";
  const timedOut = game.endsAt !== null && seconds === 0;
  const locked = busy || timedOut;
  const name = (id: string | null) =>
    game.roster.find((player) => player.id === id)?.nickname ?? "참가자";
  const who = (id: string | null) => (id === me ? "나" : `${name(id)}님`);
  const nextClue =
    basic && game.turn < game.totalTurns && game.roster.length
      ? game.roster[game.turn % game.roster.length]!.id
      : null;
  const hostAction = (action: string) =>
    onAction({ action, revision: room.revision, turn: game.turn }, true);
  const submit = (action: string, payload: Record<string, unknown>) =>
    onAction({ action, runId: game.runId, turn: game.turn, ...payload });

  const result = game.result;
  const reviewSummary = (() => {
    if (!result) return { title: "", detail: "" };
    if (result.mode === "basic") {
      if (result.skipped)
        return { title: "이번 차례는 건너뛰었어요", detail: "점수 변화 없이 다음으로 넘어가요." };
      const best = result.guesses.filter((entry) => entry.points > 0).map((entry) => who(entry.id));
      return {
        title: `비밀 숫자는 ${result.answer}도!`,
        detail: best.length
          ? `가장 가까운 사람: ${best.join(", ")} (+1점)`
          : "제출한 사람이 없어요.",
      };
    }
    const best = result.orders.filter((entry) => entry.points > 0).map((entry) => who(entry.id));
    return {
      title: "실제 순서가 공개됐어요",
      detail: best.length
        ? `가장 잘 맞힌 사람: ${best.join(", ")} (+1점)`
        : "이번 라운드는 0점이에요.",
    };
  })();

  const task: Task = (() => {
    switch (game.stage) {
      case "clue":
        return isClue
          ? {
              emoji: "🗣️",
              title: "비밀 숫자에 맞는 상황을 말해주세요",
              detail:
                "숫자는 말하지 말고 상황으로만 설명해요. 다 말하면 진행자가 숫자 고르기를 열어요.",
              tone: "act",
            }
          : {
              emoji: "👂",
              title: `${name(game.clueId)}님의 설명을 들어요`,
              detail: "설명이 끝나면 몇 도인지 고르는 화면이 열려요.",
              tone: "watch",
            };
      case "guess":
        if (isClue || !playing)
          return {
            emoji: "⏳",
            title: "다들 숫자를 고르는 중이에요",
            detail: `${game.submitted}/${game.expected}명이 제출했어요.`,
            tone: "wait",
          };
        return game.myGuess !== null
          ? {
              emoji: "✅",
              title: "제출했어요",
              detail: `내 답 ${game.myGuess}도 · 모두 내면 정답이 공개돼요.`,
              tone: "wait",
            }
          : {
              emoji: "🌡️",
              title: "몇 도일까요?",
              detail: `${name(game.clueId)}님의 설명이 0~100 중 어디쯤인지 골라요.`,
              tone: "act",
            };
      case "situations":
        if (!playing)
          return {
            emoji: "✍️",
            title: "모두 상황을 쓰는 중이에요",
            detail: `${game.submitted}/${game.expected}명이 제출했어요.`,
            tone: "watch",
          };
        return game.mySituation
          ? {
              emoji: "✅",
              title: "제출했어요",
              detail: `다른 사람을 기다려요 (${game.submitted}/${game.expected}명).`,
              tone: "wait",
            }
          : {
              emoji: "✍️",
              title: "상황 하나와 숫자를 정해요",
              detail: "주제에 맞는 상황을 짧게 쓰고, 몇 도인지 몰래 골라요.",
              tone: "act",
            };
      case "ordering":
        if (!game.mySituation)
          return {
            emoji: "🔢",
            title: "줄 세우는 중이에요",
            detail: "이번 라운드는 상황을 낸 사람만 줄을 세워요.",
            tone: "watch",
          };
        return game.myOrder
          ? {
              emoji: "✅",
              title: "제출했어요",
              detail: `다른 사람을 기다려요 (${game.submitted}/${game.expected}명).`,
              tone: "wait",
            }
          : {
              emoji: "🔢",
              title: "낮은 숫자부터 줄 세워요",
              detail: "맨 위가 가장 낮은 숫자예요. 카드를 끌거나 ↑↓로 옮긴 뒤 제출해요.",
              tone: "act",
            };
      case "review":
        return {
          emoji: "🎯",
          title: reviewSummary.title,
          detail: `${reviewSummary.detail}${
            room.isHost
              ? " 이야기를 나눈 뒤 ‘다음’을 눌러요."
              : nextClue
                ? ` 다음은 ${who(nextClue)} 차례예요.`
                : ""
          }`,
          tone: "watch",
        };
      case "aborted":
        return {
          emoji: "⏹️",
          title: "게임이 중단됐어요",
          detail: "완료된 차례의 점수만 남아요.",
          tone: "watch",
        };
      default:
        return {
          emoji: "🏁",
          title: "게임 끝!",
          detail: "최종 순위를 확인해요.",
          tone: "watch",
        };
    }
  })();

  // Briefly announce each new step (who explains, when to pick, the reveal).
  const announced = useRef<string | null>(null);
  const phase = `${game.turn}:${game.stage}`;
  useEffect(() => {
    if (announced.current === phase) return;
    announced.current = phase;
    if (finished) return;
    setToast({ id: phase, text: `${task.emoji} ${task.title}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2_600);
    return () => clearTimeout(timer);
  }, [toast]);

  const step = basic
    ? ({ clue: 1, guess: 2, review: 3 }[game.stage as string] ?? -1)
    : ({ situations: 0, ordering: 1, review: 2 }[game.stage as string] ?? -1);
  const canGuess = game.stage === "guess" && playing && !isClue && game.myGuess === null;
  const canWrite = game.stage === "situations" && playing && !game.mySituation;
  const validText = text.trim().length >= 2;

  return (
    <section className={cg.stage} aria-label="마음의 온도">
      {toast && (
        <div key={toast.id} className={cg.dgToast} role="status">
          {toast.text}
        </div>
      )}
      <header className={cg.dgTop}>
        <span className={cg.dgMode}>
          {mode.emoji} {mode.title}
        </span>
        {!finished && (
          <span className={cg.dgRound}>
            라운드 {game.round}/{game.settings.rounds}
          </span>
        )}
        {["guess", "situations", "ordering"].includes(game.stage) && (
          <span
            className={cg.dgRound}
            aria-label={`${game.expected}명 중 ${game.submitted}명 제출`}
          >
            ✋ {game.submitted}/{game.expected}명
          </span>
        )}
        {game.endsAt !== null ? (
          <span
            className={cg.clock}
            data-urgent={seconds <= 10}
            role="timer"
            aria-label={`남은 시간 ${seconds}초`}
          >
            <Clock3 size={15} aria-hidden="true" />
            {seconds}초
          </span>
        ) : (
          <span />
        )}
      </header>

      {step >= 0 && (
        <ol className={cg.dgSteps} aria-label="진행 단계">
          {mode.steps.map((s, index) => (
            <li
              key={s.title}
              data-state={index < step ? "done" : index === step ? "now" : "next"}
              aria-current={index === step ? "step" : undefined}
            >
              <span>{index < step ? "✓" : index + 1}</span>
              <small>{s.title}</small>
            </li>
          ))}
        </ol>
      )}

      <div className={cg.dgTask} data-tone={task.tone}>
        <span className={cg.dgTaskEmoji} aria-hidden="true">
          {task.emoji}
        </span>
        <div>
          <small>
            {task.tone === "act" ? "내 할 일" : task.tone === "wait" ? "기다리는 중" : "지금은"}
          </small>
          <strong>{task.title}</strong>
          <p>{task.detail}</p>
        </div>
      </div>

      {!finished && game.topic && (
        <div className={styles.topic}>
          <small>오늘의 주제</small>
          <h3>{game.topic.question}</h3>
          {game.stage !== "guess" && game.stage !== "situations" && game.stage !== "review" && (
            <Scale
              low={game.topic.low}
              high={game.topic.high}
              markers={
                game.mySecret !== null
                  ? [{ value: game.mySecret, label: "내 비밀 숫자", main: true }]
                  : []
              }
            />
          )}
        </div>
      )}

      {game.mySecret !== null && game.stage === "clue" && (
        <div className={styles.secret} style={heatStyle(game.mySecret)}>
          <span>🔒 나만 보는 비밀 숫자</span>
          <strong>{game.mySecret}</strong>
          <p>
            0 = ‘{game.topic?.low}’, 100 = ‘{game.topic?.high}’. 이 숫자만큼의 상황을 예로 들어
            말해요.
          </p>
        </div>
      )}

      {game.stage === "guess" && game.topic && (
        <>
          {canGuess ? (
            <form
              className={styles.answerForm}
              onSubmit={(event) => {
                event.preventDefault();
                if (!locked) submit("temperature-guess", { value: number });
              }}
            >
              <NumberPicker
                value={number}
                onChange={setNumber}
                disabled={locked}
                low={game.topic.low}
                high={game.topic.high}
              />
              <div className={cg.dgDock}>
                <button className={cg.button} type="submit" disabled={locked}>
                  <Send size={16} aria-hidden="true" /> {number}도로 제출
                </button>
              </div>
            </form>
          ) : (
            <Scale
              low={game.topic.low}
              high={game.topic.high}
              markers={
                game.myGuess !== null
                  ? [{ value: game.myGuess, label: "내 답", main: true }]
                  : game.mySecret !== null
                    ? [{ value: game.mySecret, label: "내 비밀 숫자", main: true }]
                    : []
              }
            />
          )}
        </>
      )}

      {game.stage === "situations" && game.topic && (
        <>
          {canWrite ? (
            <form
              className={styles.answerForm}
              onSubmit={(event) => {
                event.preventDefault();
                if (validText && !locked)
                  submit("temperature-situation", { text: text.trim(), value: number });
              }}
            >
              <label className={styles.label}>
                <span>
                  1. 상황 쓰기 <small>{text.trim().length}/160</small>
                </span>
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={160}
                  minLength={2}
                  required
                  disabled={locked}
                  placeholder="예: 중요한 발표에서 자료가 열리지 않았다"
                />
                <small>실명·연락처 같은 개인 정보는 쓰지 마세요.</small>
              </label>
              <p className={styles.stepLabel}>2. 이 상황은 몇 도일까요? (다른 사람에겐 비밀)</p>
              <NumberPicker
                value={number}
                onChange={setNumber}
                disabled={locked}
                low={game.topic.low}
                high={game.topic.high}
              />
              <div className={cg.dgDock}>
                <button className={cg.button} type="submit" disabled={locked || !validText}>
                  <Send size={16} aria-hidden="true" />
                  {validText ? `상황과 ${number}도 제출` : "상황을 먼저 써주세요"}
                </button>
              </div>
            </form>
          ) : (
            game.mySituation && (
              <div className={styles.mine} style={heatStyle(game.mySituation.value)}>
                <b>{game.mySituation.value}</b>
                <span>
                  <small>내가 낸 상황</small>
                  <p>{game.mySituation.text}</p>
                </span>
              </div>
            )
          )}
        </>
      )}

      {game.stage === "ordering" &&
        (me && game.mySituation ? (
          <>
            <div className={styles.mine} style={heatStyle(game.mySituation.value)}>
              <b>{game.mySituation.value}</b>
              <span>
                <small>힌트 · 내 상황의 숫자</small>
                <p>{game.mySituation.text}</p>
              </span>
            </div>
            <OrderCards
              game={game}
              viewerId={me}
              disabled={locked}
              onSubmit={(order) => submit("temperature-order", { order })}
            />
          </>
        ) : (
          <ul className={styles.orderCards}>
            {game.situations.map((item) => (
              <li key={item.id} className={styles.orderCard}>
                <div>
                  <strong>{name(item.id)}</strong>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
        ))}

      {timedOut && (
        <p className={styles.empty} role="status">
          시간이 끝났어요. 다음 단계를 불러오고 있어요…
        </p>
      )}

      {game.stage === "review" && <Review game={game} name={name} me={me} />}

      {game.stage === "clue" && room.isHost && (
        <div className={`${cg.dgDock} ${styles.hostDock}`}>
          <button
            className={cg.button}
            type="button"
            disabled={locked}
            onClick={() => hostAction("temperature-open")}
          >
            설명 끝 · 숫자 고르기 열기
          </button>
          <button
            className={cg.secondary}
            type="button"
            disabled={locked}
            onClick={() => hostAction("temperature-skip")}
          >
            <SkipForward size={15} aria-hidden="true" /> 이번 차례 건너뛰기
          </button>
        </div>
      )}
      {game.stage === "review" && room.isHost && (
        <div className={cg.dgDock}>
          <button
            className={cg.button}
            type="button"
            disabled={busy}
            onClick={() => hostAction("temperature-next")}
          >
            {game.turn === game.totalTurns
              ? "최종 순위 보기"
              : basic
                ? `다음 차례 · ${nextClue ? `${name(nextClue)}님 설명` : "계속"}`
                : "다음 라운드"}
          </button>
        </div>
      )}

      {finished && game.stage === "result" && <CreativeWinners players={game.roster} />}
      {(finished || game.stage === "review") && <CreativeScores players={game.roster} self={me} />}
    </section>
  );
}
