"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  LockKeyhole,
  Thermometer,
  Timer,
  Trophy,
} from "lucide-react";
import type { GameRoomView } from "@/domain/game-room";
import { TEMPERATURE_MODE_LABELS, type TemperatureView } from "@/domain/temperature-game";
import styles from "./temperature-game-stage.module.css";
import { GameRoundActions } from "./game-round-layout";

const stageLabels = {
  lobby: "준비 중",
  clue: "말로 설명",
  guess: "숫자 제출",
  situations: "상황 제출",
  ordering: "순서 제출",
  review: "결과와 대화",
  result: "최종 순위",
  aborted: "게임 중단",
} as const;

type Send = (action: Record<string, unknown>, host?: boolean) => void;

function NumberChoice({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className={styles.numberChoice}>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value === "" ? 50 : value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="숫자 선택"
        disabled={disabled}
      />
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="숫자 직접 입력"
        disabled={disabled}
        required
      />
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
  const orderForm = useId();
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
    const playArea = event.currentTarget.closest<HTMLElement>("[data-game-phase]");
    const scroller = playArea && getComputedStyle(playArea).overflowY === "auto" ? playArea : null;
    const bounds = scroller?.getBoundingClientRect();
    const top = bounds?.top ?? 0;
    const bottom = bounds?.bottom ?? window.innerHeight;
    if (event.clientY < top + 44) (scroller ?? window).scrollBy(0, -24);
    else if (event.clientY > bottom - 44) (scroller ?? window).scrollBy(0, 24);
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-temperature-card]")?.dataset.temperatureCard;
    if (!target || target === drag.current.id || target === drag.current.lastTarget) return;
    drag.current.lastTarget = target;
    move(drag.current.id, draft.indexOf(target));
  }

  return (
    <form
      id={orderForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (!locked) onSubmit(draft);
      }}
    >
      <p className={styles.help}>
        낮은 숫자부터 순서대로 놓으세요. 손잡이를 끌거나 위·아래 버튼을 눌러 옮길 수 있어요.
      </p>
      <ol className={styles.orderCards} aria-label="숫자가 낮은 순서부터 배치">
        {order.map((id, index) => (
          <li key={id} data-temperature-card={id} className={styles.orderCard}>
            <span className={styles.position} aria-label={`${index + 1}번째`}>
              {index + 1}
            </span>
            <div>
              <strong>
                {names.get(id)} {id === viewerId && <small>내 상황</small>}
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
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {game.myOrder ? (
        <p role="status" className={styles.notice}>
          순서를 제출했어요. 결과를 기다려주세요.
        </p>
      ) : (
        <GameRoundActions>
          <button className={styles.primary} type="submit" form={orderForm} disabled={locked}>
            순서 제출
          </button>
        </GameRoundActions>
      )}
    </form>
  );
}

function Results({ game, name }: { game: TemperatureView; name: (id: string | null) => string }) {
  const result = game.result;
  if (!result) return null;
  return (
    <div className={styles.result} aria-label="이번 결과">
      {result.mode === "basic" ? (
        <>
          {result.skipped ? (
            <h3>이번 차례는 건너뛰었어요</h3>
          ) : (
            <h3>
              비밀 숫자 <strong>{result.answer}</strong>
            </h3>
          )}
          {!result.skipped && result.guesses.length === 0 && (
            <p>이번 차례에 제출한 숫자가 없어요.</p>
          )}
          <ul className={styles.resultList}>
            {result.guesses.map((entry) => (
              <li key={entry.id}>
                <span>{name(entry.id)}</span>
                <span>
                  {entry.value} · 차이 {entry.distance}
                </span>
                <b>{entry.points ? "+1점" : "0점"}</b>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <h3>실제 숫자와 순서</h3>
          <ol className={styles.resultList}>
            {result.situations.map((situation) => (
              <li key={situation.id}>
                <span>
                  <strong>{name(situation.id)}</strong> · {situation.text}
                </span>
                <b>{situation.value}</b>
              </li>
            ))}
          </ol>
          {result.comparablePairs === 0 && <p>비교할 수 있는 쌍이 없어 이번 라운드는 0점이에요.</p>}
          {result.comparablePairs > 0 && !result.orders.length && (
            <p>이번 라운드에 제출한 순서가 없어요.</p>
          )}
          {result.orders.map((entry) => (
            <details className={styles.submittedOrder} key={entry.id}>
              <summary>
                {name(entry.id)} · {entry.correctPairs}/{result.comparablePairs}쌍 ·{" "}
                {entry.points ? "+1점" : "0점"}
              </summary>
              <p>{entry.order.map(name).join(" → ")}</p>
            </details>
          ))}
        </>
      )}
      {game.stage === "review" && (
        <p className={styles.notice}>같은 상황을 다르게 느낀 이유를 함께 이야기해보세요.</p>
      )}
    </div>
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
  const answerForm = useId();
  const [number, setNumber] = useState("50");
  const [text, setText] = useState("");
  const [seconds, setSeconds] = useState(() =>
    Math.max(0, Math.ceil(((game.endsAt ?? game.serverNow) - game.serverNow) / 1000)),
  );
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
  const isClue = !!me && me === game.clueId;
  const finished = game.stage === "result" || game.stage === "aborted";
  const timedOut = game.endsAt !== null && seconds === 0;
  const locked = busy || timedOut;
  const name = (id: string | null) =>
    game.roster.find((player) => player.id === id)?.nickname ?? "참가자";
  const validNumber = /^(0|[1-9]\d?|100)$/.test(number);
  const ranked = [...game.roster].sort((a, b) => b.score - a.score);
  const hostAction = (action: string) =>
    onAction({ action, revision: room.revision, turn: game.turn }, true);
  const submit = (action: string, payload: Record<string, unknown>) =>
    onAction({ action, runId: game.runId, turn: game.turn, ...payload });

  return (
    <section className={styles.stage} aria-label="마음의 온도">
      <header className={styles.header}>
        <div>
          <Thermometer size={21} aria-hidden="true" />
          <h2>마음의 온도</h2>
        </div>
        <span>{TEMPERATURE_MODE_LABELS[game.settings.mode]}</span>
      </header>
      <div className={styles.body}>
        <div className={styles.progress}>
          <span>
            {game.round}/{game.settings.rounds} 라운드 · {stageLabels[game.stage]}
          </span>
          {game.endsAt !== null && (
            <span className={styles.timer} role="timer" aria-label={`남은 시간 ${seconds}초`}>
              <Timer size={16} aria-hidden="true" />
              {seconds}초
            </span>
          )}
        </div>
        {!finished && game.topic && (
          <div className={styles.topic}>
            <h3>{game.topic.question}</h3>
            <div className={styles.scale}>
              <span>
                <b>0</b>
                {game.topic.low}
              </span>
              <span>
                <b>100</b>
                {game.topic.high}
              </span>
            </div>
          </div>
        )}
        {game.mySecret !== null && (
          <div className={styles.secret}>
            <LockKeyhole size={18} aria-hidden="true" />
            <div>
              나만 보는 비밀 숫자<strong>{game.mySecret}</strong>
            </div>
          </div>
        )}
        {game.stage === "clue" && (
          <div className={styles.notice}>
            {isClue
              ? "숫자에 어울리는 상황을 말로 설명하세요. 숫자 자체는 말하지 마세요."
              : `${name(game.clueId)} 님의 설명을 들어보세요.`}
            {room.isHost && (
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  type="button"
                  disabled={locked}
                  onClick={() => hostAction("temperature-open")}
                >
                  숫자 제출 열기
                </button>
                <button
                  className={styles.secondary}
                  type="button"
                  disabled={locked}
                  onClick={() => hostAction("temperature-skip")}
                >
                  이번 차례 건너뛰기
                </button>
              </div>
            )}
          </div>
        )}
        {game.stage === "guess" && (
          <>
            <p className={styles.help}>
              예상 숫자 제출 {game.submitted}/{game.expected}명
            </p>
            {!me || isClue ? (
              <p className={styles.notice}>참가자들의 예상 숫자를 기다려주세요.</p>
            ) : game.myGuess !== null ? (
              <p className={styles.notice} role="status">
                내 예상 숫자 {game.myGuess}를 제출했어요.
              </p>
            ) : (
              <form
                id={answerForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (validNumber && !locked)
                    submit("temperature-guess", { value: Number(number) });
                }}
              >
                <NumberChoice value={number} onChange={setNumber} disabled={locked} />
                <GameRoundActions>
                  <button
                    className={styles.primary}
                    type="submit"
                    form={answerForm}
                    disabled={locked || !validNumber}
                  >
                    예상 숫자 제출
                  </button>
                </GameRoundActions>
              </form>
            )}
          </>
        )}
        {game.stage === "situations" && (
          <>
            <p className={styles.help}>
              상황 제출 {game.submitted}/{game.expected}명
            </p>
            {!me ? (
              <p className={styles.notice}>참가자들이 상황과 숫자를 고르는 중이에요.</p>
            ) : game.mySituation ? (
              <p className={styles.notice} role="status">
                내 상황과 숫자 {game.mySituation.value}를 제출했어요. {game.mySituation.text}
              </p>
            ) : (
              <form
                id={answerForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (validNumber && text.trim().length >= 2 && !locked)
                    submit("temperature-situation", { text: text.trim(), value: Number(number) });
                }}
              >
                <label className={styles.label}>
                  나의 상황
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    maxLength={160}
                    minLength={2}
                    required
                    disabled={locked}
                    placeholder="예: 중요한 발표에서 자료가 열리지 않았다"
                  />
                </label>
                <p className={styles.help}>실명, 연락처 등 개인 정보는 입력하지 마세요.</p>
                <NumberChoice value={number} onChange={setNumber} disabled={locked} />
                <GameRoundActions>
                  <button
                    className={styles.primary}
                    type="submit"
                    form={answerForm}
                    disabled={locked || !validNumber || text.trim().length < 2}
                  >
                    상황과 숫자 제출
                  </button>
                </GameRoundActions>
              </form>
            )}
          </>
        )}
        {game.stage === "ordering" && (
          <>
            <p className={styles.help}>
              순서 제출 {game.submitted}/{game.expected}명
            </p>
            {me && game.mySituation ? (
              <>
                <p className={styles.notice}>내가 고른 숫자는 {game.mySituation.value}예요.</p>
                <OrderCards
                  game={game}
                  viewerId={me}
                  disabled={locked}
                  onSubmit={(order) => submit("temperature-order", { order })}
                />
              </>
            ) : (
              <>
                <p className={styles.notice}>
                  {!me
                    ? "참가자들이 상황의 순서를 추리하고 있어요."
                    : "이번 라운드는 상황을 제출한 사람만 순서를 맞혀요."}
                </p>
                <ul className={styles.resultList}>
                  {game.situations.map((item) => (
                    <li key={item.id}>
                      <strong>{name(item.id)}</strong>
                      <span>{item.text}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        {timedOut && (
          <p className={styles.help} role="status">
            다음 단계를 불러오고 있어요.
          </p>
        )}
        <Results game={game} name={name} />
        {game.stage === "review" && room.isHost && (
          <button
            className={styles.primary}
            type="button"
            disabled={busy}
            onClick={() => hostAction("temperature-next")}
          >
            {game.turn === game.totalTurns
              ? "최종 순위 보기"
              : game.settings.mode === "basic"
                ? "다음 차례"
                : "다음 라운드"}
          </button>
        )}
        {game.stage === "aborted" && (
          <p className={styles.notice}>호스트가 게임을 중단했어요. 완료된 차례의 점수만 남아요.</p>
        )}
        {ranked.length > 0 && (
          <div className={styles.scores}>
            <h3>
              <Trophy size={17} aria-hidden="true" /> {finished ? "최종 순위" : "누적 점수"}
            </h3>
            <ol className={styles.resultList}>
              {ranked.map((player) => (
                <li key={player.id} data-me={player.id === me}>
                  <span>
                    {ranked.findIndex((item) => item.score === player.score) + 1}위 ·{" "}
                    {player.nickname}
                  </span>
                  <b>{player.score}점</b>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
