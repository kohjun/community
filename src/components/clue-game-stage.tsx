"use client";
import { useEffect, useState, useMemo, useRef, useId } from "react";
import type { GameRoomView } from "@/domain/game-room";
import { CLUE_MODES } from "@/domain/creative-games";
import type { MapPoint, MapPin } from "@/lib/naver-maps";
import { NaverEventMap } from "./naver-event-map";
import {
  CreativeClock,
  CreativeSubmissionStatus,
  CreativeControls,
  CreativeScores,
  CreativeWinners,
  type CreativeAction,
} from "./creative-game-common";
import styles from "./creative-games.module.css";
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
    [point, setPoint] = useState<MapPoint | null>(null),
    [choice, setChoice] = useState<number | null>(null),
    [author, setAuthor] = useState(""),
    [now, setNow] = useState(Date.now()),
    [offset, setOffset] = useState(game.serverNow - Date.now()),
    [selectedResult, setSelectedResult] = useState("correct"),
    [largePhoto, setLargePhoto] = useState(false),
    [historyIndex, setHistoryIndex] = useState(0);
  useEffect(() => {
    setPoint(null);
    setChoice(null);
    setAuthor("");
    setSubmissionError("");
    setSelectedResult("correct");
    setLargePhoto(false);
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
  const src =
    q?.basicAsset ??
    (q?.assetId ? `/api/games/${room.id}/media/${q.assetId}${room.isHost ? "?host=1" : ""}` : null);
  const fraction = game.startedQuestionAt
    ? Math.max(
        0,
        Math.min(1, (now + offset - game.startedQuestionAt) / (game.settings.seconds * 1000)),
      )
    : 0;
  const zoom =
    game.settings.mode === "zoom" && game.stage === "guess"
      ? fraction < 1 / 3
        ? 3
        : fraction < 2 / 3
          ? 1.8
          : 1
      : 1;
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
                      label: `${name(a.playerId)} · ${a.distance! >= 1000 ? (a.distance! / 1000).toFixed(1) + "km" : a.distance + "m"}`,
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
                label: "내가 추리한 위치",
              },
            ]
          : [],
    [result, selected, game.roster],
  );
  async function submit() {
    if (quiz ? choice === null : !point) {
      setSubmissionError(
        quiz ? "보기 하나를 선택해주세요." : "지도에서 추리한 위치를 선택해주세요.",
      );
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
  return (
    <section className={styles.stage} aria-label="단서각 게임">
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>
            DANSEO GAK · {CLUE_MODES[game.settings.mode].title}
          </span>
          <h2>
            {finished
              ? "단서들이 이야기가 됐어요"
              : result
                ? `정답 · ${result.question.label}`
                : `이 단서의 정체는?`}
          </h2>
        </div>
        <CreativeClock
          endsAt={game.endsAt}
          serverNow={game.serverNow}
          paused={game.paused}
          onExpired={onRefresh}
        />
      </div>
      <p className={styles.progress}>
        {Math.min(game.index + 1, game.total)}/{game.total}문제 · {game.submitted}/{game.expected}명
        제출
      </p>
      {game.stage === "guess" && (
        <CreativeSubmissionStatus submitted={game.submitted} expected={game.expected} />
      )}
      {!finished && (
        <p className={styles.instruction}>
          {result
            ? member
              ? `사진 주인은 ${name(result.question.authorId)}님이에요. 사진 이야기를 나눠보세요.`
              : "정답과의 거리·선택을 비교해보고 다음 문제로 넘어가요."
            : !game.canAnswer
              ? "이번 문제는 내가 낸 사진·단서예요. 추리는 잠깐 쉬고 결과 공개 후 이야기를 나눠주세요."
              : submitted
                ? "제출을 마쳤어요. 정답과 다른 사람의 선택은 잠시 후 공개돼요."
                : CLUE_MODES[game.settings.mode].rules}
        </p>
      )}
      {finished && game.results.length > 0 && (
        <label className={styles.form}>
          문제별 결과 다시 보기
          <select
            aria-label="문제별 결과 다시 보기"
            value={historyIndex}
            onChange={(e) => {
              setHistoryIndex(Number(e.target.value));
              setSelectedResult("correct");
              setLargePhoto(false);
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
      {result && (
        <p className={styles.instruction}>
          <strong>정답 · {result.question.label}</strong>
          {quiz && result.question.choices && result.question.correctChoice !== null && (
            <> · {result.question.choices[result.question.correctChoice]}</>
          )}
          {member && <> · 사진 주인 {name(result.question.authorId)}</>}
        </p>
      )}
      {q && src && (
        <div className={quiz ? styles.form : styles.grid}>
          <div>
            {q.media === "photo" ? (
              <div className={styles.photo} data-large={largePhoto}>
                <img
                  src={src}
                  alt="위치를 추리할 장소 사진"
                  style={{ transform: `scale(${zoom})` }}
                />
              </div>
            ) : q.media === "audio" ? (
              <audio
                className={styles.mediaAudio}
                controls
                src={src}
                preload="metadata"
                aria-label="추리할 소리"
              />
            ) : (
              <video
                className={styles.media}
                controls
                playsInline
                src={src}
                preload="metadata"
                aria-label="추리할 영상"
              />
            )}
            {q.media === "photo" && (
              <div className={styles.photoTools}>
                <button className={styles.secondary} onClick={() => setLargePhoto((v) => !v)}>
                  {largePhoto ? "사진 작게 보기" : "사진 크게 보기"}
                </button>
                {!quiz && <a href="#clue-answer-map">지도에서 선택하기 ↓</a>}
              </div>
            )}
            {game.settings.mode === "zoom" && !result && (
              <p className={styles.credit}>
                사진 단서 {zoom === 3 ? 1 : zoom === 1.8 ? 2 : 3}/3 · 빠른 제출 추가 점수는 없어요.
              </p>
            )}
            {q.credit && (
              <p className={styles.credit}>
                {q.credit} ·{" "}
                {q.basicAsset && (
                  <a href="/games/credits" target="_blank" rel="noreferrer">
                    사진 출처·이용 조건
                  </a>
                )}
              </p>
            )}
            {result?.question.story && (
              <p className={styles.instruction}>{result.question.story}</p>
            )}
          </div>
          {!quiz && (
            <div>
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
                  picking={game.canAnswer && !submitted && !game.paused && !busy}
                  onPick={setPoint}
                  focusPoint={{ latitude: 36.5, longitude: 127.8, zoom: 6 }}
                />
              </div>
              <p className={styles.credit}>
                {result
                  ? "지도 핀은 참가자들이 추리한 위치예요."
                  : "지도에서 추리한 지점을 누르세요. 내 현재 위치는 사용하지 않아요."}
              </p>
            </div>
          )}
        </div>
      )}
      {game.stage === "guess" && quiz && q?.choices && (
        <fieldset
          className={styles.modeFieldset}
          disabled={busy || submitted || !game.canAnswer || game.paused}
        >
          <legend>정답 보기</legend>
          <div className={styles.options}>
            {q.choices.map((v, i) => (
              <label
                className={styles.option}
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
      {game.stage === "guess" && game.canAnswer && !submitted && (
        <form
          method="post"
          aria-label="단서각 정답 제출"
          className={`${styles.form} ${styles.submitBar}`}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {member && (
            <label>
              이 사진을 낸 사람은?
              <select
                name="photoAuthor"
                required
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              >
                <option value="">사진 주인을 선택해주세요</option>
                {game.roster
                  .filter((p) => p.id !== self)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nickname}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <button type="submit" className={styles.button} disabled={busy || game.paused}>
            {quiz ? "이 답으로 제출" : "이 위치로 제출"}
            {member ? " · 사진 주인도 함께" : ""}
          </button>
          <p className={styles.muted}>제출을 확정한 뒤에는 바꿀 수 없어요.</p>
        </form>
      )}
      {result && (
        <ul className={styles.results}>
          {game.roster.map((p) => {
            const a = result.answers.find((a) => a.playerId === p.id);
            return (
              <li key={p.id} className={styles.resultRow}>
                <span>
                  {p.nickname}
                  {p.id === self ? " · 나" : ""}
                  <br />
                  <small>
                    {p.id === result.question.authorId
                      ? "출제자 · 채점 제외"
                      : !a
                        ? "미제출"
                        : quiz
                          ? `${String.fromCharCode(65 + (a.choice ?? 0))} 선택${a.points ? " · 정답!" : ""}`
                          : `정답까지 ${a.distance! >= 1000 ? (a.distance! / 1000).toFixed(1) + "km" : a.distance + "m"}${member ? ` · 주인 ${a.authorId === result.question.authorId ? "정답" : "오답"}` : ""}`}
                  </small>
                </span>
                <b>+{a?.points ?? 0}점</b>
              </li>
            );
          })}
        </ul>
      )}
      {finished && (
        <>
          <CreativeWinners players={game.roster} />
          <div className={styles.hint}>
            {game.results.map((r, i) => (
              <details key={r.question.id}>
                <summary>
                  {i + 1}. {r.question.label}
                </summary>
                <p>{r.question.story}</p>
                <p>{r.answers.map((a) => `${name(a.playerId)} ${a.points}점`).join(" · ")}</p>
              </details>
            ))}
          </div>
        </>
      )}
      {submissionError && (
        <p ref={errorRef} tabIndex={-1} className={styles.error} role="alert">
          {submissionError}
        </p>
      )}
      <CreativeScores players={game.roster} self={self} />
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
