"use client";
import { useEffect, useState, useMemo, useRef, useId } from "react";
import { MapPin as MapPinIcon, Send } from "lucide-react";
import type { GameRoomView } from "@/domain/game-room";
import { CLUE_MODES } from "@/domain/creative-games";
import type { MapPoint, MapPin } from "@/lib/naver-maps";
import { NaverEventMap } from "./naver-event-map";
import { NaverStreetView } from "./naver-street-view";
import {
  CreativeClock,
  CreativeControls,
  CreativeScores,
  CreativeWinners,
  type CreativeAction,
} from "./creative-game-common";
import styles from "./creative-games.module.css";

type Task = { emoji: string; title: string; detail: string; tone: "act" | "wait" | "watch" };
const distanceText = (m: number) =>
  m >= 100_000 ? `${Math.round(m / 1000)}km` : m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`;
/** Zoom-out mode: how wide the street view is in each third of the time limit. */
const ZOOM_STAGES = [
  { fov: 28, scale: 3 },
  { fov: 55, scale: 1.8 },
  { fov: 100, scale: 1 },
] as const;

export function ClueGameStage({
  room,
  busy,
  onAction,
  onRefresh,
}: {
  room: GameRoomView;
  busy: boolean;
  onAction: CreativeAction;
  onRefresh: () => void;
}) {
  const uid = useId(),
    errorRef = useRef<HTMLParagraphElement>(null),
    [submissionError, setSubmissionError] = useState("");
  const game = room.clue!,
    mode = CLUE_MODES[game.settings.mode],
    [point, setPoint] = useState<MapPoint | null>(null),
    [choice, setChoice] = useState<number | null>(null),
    [author, setAuthor] = useState(""),
    [now, setNow] = useState(Date.now()),
    [offset, setOffset] = useState(game.serverNow - Date.now()),
    [selectedResult, setSelectedResult] = useState("correct"),
    [historyIndex, setHistoryIndex] = useState(0),
    [toast, setToast] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    setPoint(null);
    setChoice(null);
    setAuthor("");
    setSubmissionError("");
    setSelectedResult("correct");
  }, [game.phaseId]);
  useEffect(() => {
    setOffset(game.serverNow - Date.now());
  }, [game.serverNow]);
  useEffect(() => {
    if (game.paused) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [game.paused]);
  const finished = ["result", "aborted"].includes(game.stage),
    result = finished ? (game.results[historyIndex] ?? null) : game.result,
    q = game.question ?? result?.question ?? null,
    self = room.viewer.id,
    quiz = game.settings.mode === "quiz",
    member = game.settings.mode === "member";
  const own = game.myAnswer,
    selected = own?.point ?? point,
    submitted = !!own;
  const name = (id: string | null) => game.roster.find((p) => p.id === id)?.nickname ?? "호스트";
  const who = (id: string | null) => (id === self ? "나" : `${name(id)}님`);
  const src =
    q?.basicAsset ??
    (q?.assetId ? `/api/games/${room.id}/media/${q.assetId}${room.isHost ? "?host=1" : ""}` : null);
  const fraction = game.startedQuestionAt
    ? Math.max(
        0,
        Math.min(1, (now + offset - game.startedQuestionAt) / (game.settings.seconds * 1000)),
      )
    : 0;
  const zoomStage =
    game.settings.mode === "zoom" && game.stage === "guess"
      ? fraction < 1 / 3
        ? 0
        : fraction < 2 / 3
          ? 1
          : 2
      : 2;
  const palette = [
    "#2563eb",
    "#7c3aed",
    "#0891b2",
    "#059669",
    "#db2777",
    "#c2410c",
    "#4f46e5",
    "#0f766e",
    "#9d174d",
    "#854d0e",
    "#1d4ed8",
    "#475569",
  ];
  const colour = (id: string) =>
    palette[
      Math.max(
        0,
        game.roster.findIndex((p) => p.id === id),
      ) % palette.length
    ]!;
  const pins: MapPin[] = useMemo(
    () =>
      result
        ? [
            ...(result.question.point
              ? [
                  {
                    ...result.question.point,
                    id: "correct",
                    kind: "place" as const,
                    badge: "정답",
                    colour: "#0A84FE",
                    label: `정답 · ${result.question.label}`,
                  },
                ]
              : []),
            ...result.answers.flatMap((a) =>
              a.point
                ? [
                    {
                      ...a.point,
                      id: a.playerId,
                      kind: "event" as const,
                      badge: "추리",
                      colour: colour(a.playerId),
                      label: `${name(a.playerId)} · ${distanceText(a.distance!)}`,
                    },
                  ]
                : [],
            ),
          ]
        : selected
          ? [
              {
                ...selected,
                id: "my-guess",
                kind: "event",
                badge: "내 추리",
                colour: "#2563eb",
                label: "내가 꽂은 핀",
              },
            ]
          : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, selected, game.roster],
  );
  async function submit() {
    if (quiz ? choice === null : !point) {
      setSubmissionError(quiz ? "보기 하나를 골라주세요." : "지도를 눌러 핀을 먼저 꽂아주세요.");
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    if (member && !author) {
      setSubmissionError("사진 주인을 골라주세요.");
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setSubmissionError("");
    await onAction({
      action: "clue-answer",
      runId: game.runId,
      phaseId: game.phaseId,
      ...(quiz ? { choice } : { point, ...(member ? { authorId: author } : {}) }),
    });
  }

  // Ranked results for the current reveal: best first, unanswered last.
  const ranked = useMemo(() => {
    if (!result) return [];
    return game.roster
      .map((p) => ({ player: p, answer: result.answers.find((a) => a.playerId === p.id) }))
      .sort((a, b) => {
        const pa = a.answer?.points ?? -1,
          pb = b.answer?.points ?? -1;
        if (pb !== pa) return pb - pa;
        return (a.answer?.distance ?? Infinity) - (b.answer?.distance ?? Infinity);
      });
  }, [result, game.roster]);
  const winnerLine = (() => {
    if (!result) return "";
    const best = ranked.find((r) => (r.answer?.points ?? 0) > 0);
    if (!best) return "이번 문제는 아무도 점수를 얻지 못했어요.";
    if (quiz) {
      const count = ranked.filter((r) => (r.answer?.points ?? 0) > 0).length;
      return `${count}명이 맞혔어요!`;
    }
    return `가장 가까운 사람: ${who(best.player.id)} (${distanceText(best.answer!.distance!)})`;
  })();

  const task: Task = finished
    ? {
        emoji: "🏁",
        title: "게임 끝!",
        detail: "최종 점수와 문제별 정답을 확인해요.",
        tone: "watch",
      }
    : game.paused
      ? {
          emoji: "⏸️",
          title: "잠깐 쉬는 중",
          detail: "진행자가 다시 시작하면 이어서 해요.",
          tone: "wait",
        }
      : result
        ? {
            emoji: "🎯",
            title: `정답은 ‘${result.question.label}’`,
            detail: member
              ? `${who(result.question.authorId)}의 사진이었어요. ${winnerLine}`
              : winnerLine,
            tone: "watch",
          }
        : !game.canAnswer
          ? {
              emoji: "🙈",
              title: "내가 낸 문제예요",
              detail: "이번엔 쉬어요. 다른 사람들이 맞히는 모습을 지켜봐요.",
              tone: "watch",
            }
          : submitted
            ? {
                emoji: "✅",
                title: "제출했어요",
                detail: "모두 내면 정답과 다른 사람의 답이 공개돼요.",
                tone: "wait",
              }
            : quiz
              ? {
                  emoji: "🧭",
                  title: "여기는 어디일까요?",
                  detail: "거리뷰를 끌어서 둘러보고, 아래 보기에서 하나를 골라요.",
                  tone: "act",
                }
              : member
                ? {
                    emoji: "📸",
                    title: "누가 어디서 찍었을까요?",
                    detail: "지도에 찍은 곳을 꽂고, 아래에서 사진 주인도 골라요.",
                    tone: "act",
                  }
                : {
                    emoji: "📍",
                    title: "이 거리는 어디일까요?",
                    detail:
                      game.settings.mode === "zoom"
                        ? "점점 넓게 보여요. 확신이 들면 지도에 핀을 꽂아요."
                        : "거리뷰를 끌어서 둘러보고, 지도에 핀을 꽂아요.",
                    tone: "act",
                  };

  // Announce each new question / reveal briefly.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (announced.current === null) {
      announced.current = game.phaseId;
      return;
    }
    if (announced.current === game.phaseId) return;
    announced.current = game.phaseId;
    setToast({ id: game.phaseId, text: `${task.emoji} ${task.title}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.phaseId]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2_600);
    return () => clearTimeout(timer);
  }, [toast]);

  const showMap = !quiz && (game.stage === "guess" || !!result);
  const canSubmit = game.stage === "guess" && game.canAnswer && !submitted;

  return (
    <section className={styles.stage} aria-label="단서각 게임">
      {toast && (
        <div key={toast.id} className={styles.dgToast} role="status">
          {toast.text}
        </div>
      )}
      <header className={styles.dgTop}>
        <span className={styles.dgMode}>
          {mode.emoji} {mode.title}
        </span>
        {!finished && (
          <span className={styles.dgRound}>
            문제 {Math.min(game.index + 1, game.total)}/{game.total}
          </span>
        )}
        {game.stage === "guess" && (
          <span
            className={styles.dgRound}
            aria-label={`${game.expected}명 중 ${game.submitted}명 제출`}
          >
            ✋ {game.submitted}/{game.expected}명
          </span>
        )}
        <CreativeClock
          endsAt={game.endsAt}
          serverNow={game.serverNow}
          paused={game.paused}
          onExpired={onRefresh}
        />
      </header>

      <div className={styles.dgTask} data-tone={task.tone}>
        <span className={styles.dgTaskEmoji} aria-hidden="true">
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

      {finished && game.results.length > 0 && (
        <label className={styles.form}>
          문제별 결과 다시 보기
          <select
            aria-label="문제별 결과 다시 보기"
            value={historyIndex}
            onChange={(e) => {
              setHistoryIndex(Number(e.target.value));
              setSelectedResult("correct");
            }}
          >
            {game.results.map((r, i) => (
              <option key={r.question.id} value={i}>
                {i + 1}. {r.question.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {q && (q.media === "street" ? !!q.street : !!src) && (
        <div className={styles.clueMedia} data-compact={!!result}>
          {q.media === "street" && q.street ? (
            <NaverStreetView
              key={q.id}
              panoId={q.street.panoId}
              pan={q.street.pan}
              fov={ZOOM_STAGES[zoomStage].fov}
            />
          ) : q.media === "photo" ? (
            <div className={styles.photo}>
              <img
                src={src!}
                alt="위치를 추리할 사진"
                style={{ transform: `scale(${ZOOM_STAGES[zoomStage].scale})` }}
              />
            </div>
          ) : q.media === "audio" ? (
            <audio
              className={styles.mediaAudio}
              controls
              src={src!}
              preload="metadata"
              aria-label="추리할 소리"
            />
          ) : (
            <video
              className={styles.media}
              controls
              playsInline
              src={src!}
              preload="metadata"
              aria-label="추리할 영상"
            />
          )}
          <div className={styles.clueMediaFoot}>
            {game.settings.mode === "zoom" && game.stage === "guess" ? (
              <span className={styles.clueZoom} aria-label={`단서 ${zoomStage + 1}/3 단계`}>
                {ZOOM_STAGES.map((_, i) => (
                  <i key={i} data-on={i <= zoomStage} />
                ))}
                <b>{zoomStage < 2 ? "곧 더 넓게 보여요" : "전체 화면이에요"}</b>
              </span>
            ) : q.media === "street" && game.stage === "guess" ? (
              <span>👆 끌어서 둘러볼 수 있어요</span>
            ) : (
              <span />
            )}
            {q.credit && <small>{q.credit}</small>}
          </div>
        </div>
      )}

      {result?.question.story && <p className={styles.instruction}>{result.question.story}</p>}

      {game.stage === "guess" && quiz && q?.choices && (
        <fieldset
          className={`${styles.modeFieldset} ${styles.clueChoices}`}
          disabled={busy || submitted || !game.canAnswer || game.paused}
        >
          <legend>어디일까요?</legend>
          <div>
            {q.choices.map((v, i) => (
              <label
                key={i}
                htmlFor={`${uid}-choice-${i}`}
                data-selected={(own?.choice ?? choice) === i}
              >
                <input
                  id={`${uid}-choice-${i}`}
                  type="radio"
                  name={`${uid}-choice`}
                  value={i}
                  checked={(own?.choice ?? choice) === i}
                  className={styles.hiddenLabel}
                  onChange={() => {
                    setChoice(i);
                    setSubmissionError("");
                  }}
                />
                <span aria-hidden="true">{String.fromCharCode(65 + i)}</span>
                {v}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {result && quiz && result.question.choices && result.question.correctChoice !== null && (
        <ul className={styles.clueChoiceResult}>
          {result.question.choices.map((v, i) => {
            const pickers = result.answers
              .filter((a) => a.choice === i)
              .map((a) => who(a.playerId));
            return (
              <li key={i} data-correct={i === result.question.correctChoice}>
                <strong>
                  {String.fromCharCode(65 + i)}. {v}
                  {i === result.question.correctChoice && " ✅"}
                </strong>
                <small>{pickers.length ? pickers.join(", ") : "아무도 안 골랐어요"}</small>
              </li>
            );
          })}
        </ul>
      )}

      {showMap && (
        <div className={styles.clueMapBlock}>
          <p className={styles.dgCanvasLabel}>
            <MapPinIcon size={16} aria-hidden="true" />
            {result
              ? "정답(파랑)과 각자 꽂은 핀"
              : selected
                ? submitted
                  ? "내가 제출한 위치"
                  : "핀을 꽂았어요 · 다시 누르면 옮겨져요"
                : "지도를 눌러 핀을 꽂아요"}
          </p>
          <div id="clue-answer-map" className={styles.map}>
            <NaverEventMap
              clientId={process.env.NEXT_PUBLIC_NAVER_MAP_KEY_ID ?? null}
              pins={pins}
              connections={
                result?.question.point
                  ? result.answers.flatMap((a) =>
                      a.point
                        ? [
                            {
                              from: a.point,
                              to: result.question.point!,
                              colour: colour(a.playerId),
                            },
                          ]
                        : [],
                    )
                  : []
              }
              selectedId={result ? selectedResult : selected ? "my-guess" : null}
              onSelect={(id) => {
                if (result) setSelectedResult(id);
              }}
              onBoundsChange={() => {}}
              picking={canSubmit && !game.paused && !busy}
              onPick={(next) => {
                setPoint(next);
                setSubmissionError("");
              }}
              focusPoint={{ latitude: 36.5, longitude: 127.8, zoom: 6 }}
            />
          </div>
        </div>
      )}

      {canSubmit && (
        <form
          method="post"
          aria-label="단서각 정답 제출"
          className={`${styles.dgDock} ${styles.clueDock}`}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {member && (
            <select
              name="photoAuthor"
              aria-label="이 사진을 낸 사람"
              value={author}
              onChange={(e) => {
                setAuthor(e.target.value);
                setSubmissionError("");
              }}
            >
              <option value="">사진 주인은 누구?</option>
              {game.roster
                .filter((p) => p.id !== self)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nickname}
                  </option>
                ))}
            </select>
          )}
          <button
            type="submit"
            className={styles.button}
            disabled={busy || game.paused || (quiz ? choice === null : !point)}
          >
            <Send size={16} />
            {quiz
              ? choice === null
                ? "보기를 골라주세요"
                : "이 답으로 제출"
              : point
                ? "이 위치로 제출"
                : "지도에 핀을 먼저 꽂아요"}
          </button>
          <small>제출하면 바꿀 수 없어요.</small>
        </form>
      )}

      {result && (
        <ol className={styles.clueRanking} aria-label="이번 문제 결과">
          {ranked.map(({ player, answer }, index) => (
            <li key={player.id} data-self={player.id === self}>
              <b>{answer?.points ? (index === 0 ? "🥇" : "✅") : "·"}</b>
              <div>
                <strong>
                  {player.nickname}
                  {player.id === self ? " (나)" : ""}
                </strong>
                <small>
                  {player.id === result.question.authorId
                    ? "출제자 · 이번엔 쉬어요"
                    : !answer
                      ? "제출하지 않았어요"
                      : quiz
                        ? `${String.fromCharCode(65 + (answer.choice ?? 0))} 선택 · ${answer.points ? "정답!" : "오답"}`
                        : `정답까지 ${distanceText(answer.distance!)}${member ? ` · 사진 주인 ${answer.authorId === result.question.authorId ? "맞힘" : "틀림"}` : ""}`}
                </small>
              </div>
              <em>+{answer?.points ?? 0}점</em>
            </li>
          ))}
        </ol>
      )}

      {finished && <CreativeWinners players={game.roster} />}
      {submissionError && (
        <p ref={errorRef} tabIndex={-1} className={styles.error} role="alert">
          {submissionError}
        </p>
      )}
      {(finished || !!result) && <CreativeScores players={game.roster} self={self} />}
      <CreativeControls
        room={room}
        phaseId={game.phaseId}
        paused={game.paused}
        busy={busy}
        onAction={onAction}
      />
    </section>
  );
}
