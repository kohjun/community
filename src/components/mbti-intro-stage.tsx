"use client";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, UsersRound, Mic2, Trophy, LockKeyhole } from "lucide-react";
import { MBTI_TYPES, type Mbti } from "@/domain/mbti-game";
import { INTRO_PROMPTS } from "@/domain/mbti-intro";
import type { GameRoomView } from "@/domain/game-room";
import styles from "./mbti-intro-stage.module.css";
export function MbtiPicker({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (v: Mbti) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      className={styles.select}
      aria-label={label}
      required
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value as Mbti)}
    >
      <option value="">MBTI 선택</option>
      {MBTI_TYPES.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}
export function MbtiIntroStage({
  room,
  busy,
  onAction,
}: {
  room: GameRoomView;
  busy: boolean;
  onAction: (action: Record<string, unknown>, host?: boolean) => void;
}) {
  const g = room.mbtiIntro!,
    others = g.roster.filter((p) => p.id !== room.viewer.id),
    [draft, setDraft] = useState<Record<string, Mbti>>(() =>
      Object.fromEntries(
        others.flatMap((p, i) =>
          g.history.at(-1)?.guesses[i] ? [[p.id, g.history.at(-1)!.guesses[i]!]] : [],
        ),
      ),
    ),
    [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!g.turnStartedAt) return;
    const start = g.turnStartedAt,
      offset = g.serverNow - Date.now();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() + offset - start) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [g.turnStartedAt, g.serverNow]);
  const name = (id: string | null) => g.roster.find((p) => p.id === id)?.nickname ?? "참가자";
  const hostAction = (action: string) => onAction({ action, revision: room.revision }, true);
  const finished = g.stage === "result",
    aborted = g.stage === "aborted",
    mine = g.history.find((a) => a.round === g.round),
    myTurn = g.stage === "acting" && g.speakerId === room.viewer.id;
  return (
    <section className={styles.stage} aria-label="MBTI 자기소개 게임">
      <header className={styles.header}>
        <span>
          <UsersRound size={18} /> GET TO KNOW YOU
        </span>
        <strong>
          ROUND {g.round} <small>/ {g.maxRounds}</small>
        </strong>
      </header>
      <div className={styles.body}>
        <div className={styles.steps}>
          <span data-active={g.stage === "acting"}>01 상황과 소개</span>
          <ArrowRight size={12} />
          <span data-active={g.stage === "guessing"}>02 MBTI 추리</span>
          <ArrowRight size={12} />
          <span data-active={g.stage === "review" || finished}>03 결과 확인</span>
        </div>
        {aborted ? (
          <>
            <h2>게임을 중단했어요</h2>
            <p>입력한 MBTI는 공개하지 않았어요.</p>
          </>
        ) : finished ? (
          <div className={styles.result}>
            <Trophy size={34} />
            <h2>{g.winner ? `${name(g.winner)} 님이 모두 맞혔어요!` : "모두의 MBTI를 공개해요"}</h2>
            <p>
              {g.winner
                ? "전원을 가장 먼저 맞힌 참가자가 승리했어요."
                : `${g.maxRounds}라운드를 모두 마쳤어요. 정답자는 없지만 서로를 더 알아갔어요.`}
            </p>
            <div className={styles.answerGrid}>
              {g.answers?.map((p) => (
                <div key={p.id}>
                  <span>
                    {p.nickname}
                    {p.id === room.viewer.id ? " · 나" : ""}
                  </span>
                  <strong>{p.mbti}</strong>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <h2>
              {g.stage === "acting"
                ? "이 상황에서 나는 이렇게 해요"
                : g.stage === "guessing"
                  ? "설명을 듣고, MBTI를 추리해요"
                  : "이번 라운드를 확인해요"}
            </h2>
            <blockquote>{INTRO_PROMPTS[(g.round - 1) % INTRO_PROMPTS.length]}</blockquote>
            {g.stage === "acting" && (
              <div className={styles.turn}>
                <Mic2 size={22} />
                <div>
                  <small>지금 설명할 사람</small>
                  <strong>
                    {name(g.speakerId)}
                    {myTurn ? " · 내 차례" : ""}
                  </strong>
                </div>
                <span className={styles.clock}>
                  {elapsed}초<small>설명 중</small>
                </span>
                {(room.isHost || myTurn) && (
                  <button
                    className={styles.primary}
                    disabled={busy}
                    onClick={() =>
                      room.isHost
                        ? hostAction("intro-next-turn")
                        : onAction({ action: "intro-turn-done", round: g.round, turn: g.turn })
                    }
                  >
                    {room.isHost ? "다음 차례로" : "설명 완료"}
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
            )}
            <ol className={styles.order} aria-label="설명 순서">
              {g.roster.map((p, i) => (
                <li key={p.id} data-current={p.id === g.speakerId}>
                  <span>{i + 1}</span>
                  {p.nickname}
                  {g.stage !== "acting" || i < g.turn ? <CheckCircle2 size={14} /> : null}
                </li>
              ))}
            </ol>
            <div className={styles.summary}>
              <span>
                {g.stage === "acting"
                  ? "설명을 들으며 미리 선택해도 좋아요"
                  : `추리 제출 ${g.submittedCount} / ${g.roster.length}명`}
              </span>
              {!room.isHost && g.myMbti && (
                <span>
                  <LockKeyhole size={12} /> 내 MBTI {g.myMbti}
                </span>
              )}
            </div>
            <details className={styles.history}>
              <summary>MBTI 글자 뜻 보기</summary>
              <p>
                E 외향 / I 내향 · S 감각 / N 직관 · T 사고 / F 감정 · J 판단 / P 인식. 상대의 설명을
                듣고 자유롭게 추리해보세요.
              </p>
            </details>
            {!room.isHost && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (g.stage !== "guessing" || g.hasSubmitted) return;
                  if (confirm("이번 라운드의 추리를 제출할까요? 제출 후에는 수정할 수 없어요."))
                    onAction({
                      action: "intro-submit",
                      round: g.round,
                      guesses: others.map((p) => ({ playerId: p.id, mbti: draft[p.id] })),
                    });
                }}
              >
                <div className={styles.guessGrid}>
                  {others.map((p, i) => (
                    <label key={p.id}>
                      <span>{p.nickname}</span>
                      <MbtiPicker
                        label={`${p.nickname} MBTI 추리`}
                        value={g.hasSubmitted ? (mine?.guesses[i] ?? "") : (draft[p.id] ?? "")}
                        disabled={busy || g.hasSubmitted || g.stage === "review"}
                        onChange={(v) => setDraft((d) => ({ ...d, [p.id]: v }))}
                      />
                    </label>
                  ))}
                </div>
                {g.stage === "acting" && (
                  <p className={styles.hint}>
                    미리 선택하거나 수정할 수 있어요. 전원의 설명이 끝나면 제출 버튼이 열려요.
                  </p>
                )}
                <button
                  className={styles.primary}
                  type="submit"
                  disabled={
                    busy ||
                    g.stage !== "guessing" ||
                    g.hasSubmitted ||
                    others.some((p) => !draft[p.id])
                  }
                >
                  {g.hasSubmitted
                    ? "이번 라운드 제출 완료"
                    : g.stage === "acting"
                      ? "설명이 끝나면 제출할 수 있어요"
                      : "이번 라운드 추리 제출"}
                </button>
              </form>
            )}
            {mine && (
              <div className={styles.feedback} role="status">
                <span>나의 {g.round}라운드 결과</span>
                <div>
                  <strong>{mine.correct}명 O</strong>
                  <strong>{mine.incorrect}명 X</strong>
                </div>
                <p>누구를 맞혔는지는 게임이 끝난 뒤 공개돼요.</p>
              </div>
            )}
            {room.isHost && g.stage === "guessing" && (
              <button
                className={styles.secondary}
                disabled={busy}
                onClick={() => {
                  if (confirm("아직 제출하지 않은 참가자는 이번 라운드를 건너뛰고 마감할까요?"))
                    hostAction("intro-end-round");
                }}
              >
                이번 라운드 마감
              </button>
            )}
            {g.stage === "review" && (
              <div className={styles.next}>
                <p>정답자는 없어요. 결과를 확인하고 다음 상황에서 다시 추리해보세요.</p>
                {room.isHost ? (
                  <button
                    className={styles.primary}
                    disabled={busy}
                    onClick={() => hostAction("intro-next")}
                  >
                    다음 라운드 시작 <ArrowRight size={16} />
                  </button>
                ) : (
                  <span>호스트가 다음 라운드를 준비하고 있어요.</span>
                )}
              </div>
            )}
            {g.history.length > 0 && (
              <details className={styles.history}>
                <summary>내 추리 기록 · {g.history.length}회</summary>
                {g.history.map((a) => (
                  <div key={a.round}>
                    <b>{a.round}라운드</b>
                    <span>
                      {a.correct}명 O · {a.incorrect}명 X
                    </span>
                  </div>
                ))}
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
