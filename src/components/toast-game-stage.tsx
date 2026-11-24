"use client";
import { useEffect, useRef, useState } from "react";
import { Clock3, GlassWater, LockKeyhole, MessageCircle, Send, SkipForward } from "lucide-react";
import type { GameRoomView } from "@/domain/game-room";
import { TOAST_MODE_INFO } from "@/domain/toast-game";
import { CreativeScores } from "./creative-game-common";
import cg from "./creative-games.module.css";
import styles from "./toast-game-stage.module.css";

type Task = { emoji: string; title: string; detail: string; tone: "act" | "wait" | "watch" };

export function ToastGameStage({
  room,
  busy,
  onAction,
  onRefresh,
}: {
  room: GameRoomView;
  busy: boolean;
  onAction: (action: Record<string, unknown>, host?: boolean) => void;
  onRefresh: () => void;
}) {
  const g = room.toast!,
    me = room.viewer.id,
    isQuestioner = me !== null && me === g.questionerId,
    mode = TOAST_MODE_INFO[g.settings.mode],
    basic = g.settings.mode === "basic";
  const [draft, setDraft] = useState(""),
    [cheers, setCheers] = useState<boolean | null>(null),
    [prediction, setPrediction] = useState<number | null>(null),
    [seconds, setSeconds] = useState(0),
    [lastTarget, setLastTarget] = useState(""),
    [lastTurn, setLastTurn] = useState(""),
    [toast, setToast] = useState<{ id: string; text: string } | null>(null);
  const refresh = useRef(onRefresh),
    refreshed = useRef<number | null>(null);
  refresh.current = onRefresh;
  useEffect(() => {
    setDraft("");
    setCheers(null);
    setPrediction(null);
  }, [g.turn]);
  useEffect(() => {
    if (g.endsAt === null) return;
    const end = g.endsAt,
      offset = g.serverNow - Date.now();
    const tick = () => {
      const left = Math.max(0, Math.ceil((end - Date.now() - offset) / 1000));
      setSeconds(left);
      if (left === 0 && refreshed.current !== end) {
        refreshed.current = end;
        refresh.current();
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [g.endsAt, g.serverNow]);

  const name = (id: string | null) => g.roster.find((p) => p.id === id)?.nickname ?? "참가자";
  const who = (id: string | null) => (id === me ? "나" : `${name(id)}님`);
  const hostAction = (action: string) =>
    onAction({ action, revision: room.revision, turn: g.turn }, true);
  const latest = g.history.at(-1),
    isWinner = me !== null && g.winners.includes(me),
    sentLast = !!g.lastWords.find((v) => v.fromId === me);
  const playing = me !== null && g.roster.some((p) => p.id === me);
  const own = g.myAnswer?.cheers ?? cheers,
    needsPrediction = isQuestioner && basic;
  const locked = busy || g.mySubmitted || seconds === 0;
  const canSubmit = own !== null && (!needsPrediction || prediction !== null) && !locked;
  const finished = g.stage === "result" || g.stage === "aborted";
  const total = g.roster.length;

  const task: Task = (() => {
    if (g.stage === "asking")
      return isQuestioner
        ? {
            emoji: "💬",
            title: "내가 질문할 차례예요",
            detail: basic
              ? "추천 질문을 누르거나 직접 써서 공개해요. 몇 명이 ‘나도!’ 할지 고민되는 질문이 좋아요."
              : `나만 보는 목표는 건배 ${g.target ?? 0}명이에요. 딱 그만큼 건배할 질문을 만들어요.`,
            tone: "act",
          }
        : {
            emoji: "💬",
            title: `${name(g.questionerId)}님이 질문을 고르는 중`,
            detail: "질문이 나오면 건배 또는 패스를 몰래 골라요.",
            tone: "watch",
          };
    if (g.stage === "answering") {
      if (!playing)
        return {
          emoji: "🔒",
          title: "모두 몰래 고르는 중이에요",
          detail: `${g.submittedCount}/${total}명 제출 · 모두 내면 인원이 공개돼요.`,
          tone: "watch",
        };
      if (g.mySubmitted)
        return {
          emoji: "✅",
          title: `${g.myAnswer?.cheers ? "건배" : "패스"}로 제출했어요`,
          detail: `${g.submittedCount}/${total}명 제출 · 모두 내면 인원이 공개돼요.`,
          tone: "wait",
        };
      return {
        emoji: "🥂",
        title: "건배? 패스?",
        detail: needsPrediction
          ? "나도 그렇다면 건배, 아니면 패스. 그리고 나 포함 몇 명이 건배할지 예상해요."
          : "나도 그렇다면 건배, 아니면 패스. 누가 뭘 골랐는지는 공개되지 않아요.",
        tone: "act",
      };
    }
    if (g.stage === "review" && latest) {
      if (latest.outcome === "skipped")
        return {
          emoji: "⏭️",
          title: "이번 질문은 쉬어가요",
          detail: `${who(latest.questionerId)} 차례를 건너뛰었어요.`,
          tone: "watch",
        };
      return {
        emoji: latest.points ? "🎉" : "🥂",
        title: `건배 ${latest.actual}명!`,
        detail: `${basic ? "예상" : "목표"} ${latest.expected === null ? "미제출" : `${latest.expected}명`} → ${
          latest.points ? `딱 맞았어요! ${who(latest.questionerId)} +1점` : "아쉽게 빗나갔어요"
        }`,
        tone: "watch",
      };
    }
    if (g.stage === "aborted")
      return {
        emoji: "⏹️",
        title: "게임을 중단했어요",
        detail: "완료한 차례의 점수만 남겨요.",
        tone: "watch",
      };
    return {
      emoji: "🏆",
      title: "게임 끝!",
      detail: isWinner
        ? "1등이에요! 아래에서 마지막 한마디를 보내봐요."
        : "1등이 마지막 한마디를 보낼 수 있어요.",
      tone: "watch",
    };
  })();

  const step =
    g.stage === "asking" ? 0 : g.stage === "answering" ? 1 : g.stage === "review" ? 2 : -1;

  // Briefly announce each new step (whose question, time to choose, the count).
  const announced = useRef<string | null>(null);
  const phase = `${g.turn}:${g.stage}`;
  useEffect(() => {
    if (announced.current === phase) return;
    const first = announced.current === null;
    announced.current = phase;
    if (first || g.stage === "lobby") return;
    setToast({ id: phase, text: `${task.emoji} ${task.title}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2_600);
    return () => clearTimeout(timer);
  }, [toast]);

  if (g.stage === "lobby")
    return (
      <section className={styles.prepare} aria-label="건배의 눈치 안내">
        <span className={styles.logo} aria-hidden="true">
          {mode.emoji}
        </span>
        <div>
          <h2>건배의 눈치 · {mode.title}</h2>
          <p>{mode.description}</p>
          <ol className={styles.prepareSteps}>
            {mode.steps.map((s, i) => (
              <li key={s.title}>
                <b>{i + 1}</b> {s.title}
              </li>
            ))}
          </ol>
          <p className={styles.note}>
            ‘건배’는 질문에 대한 선택이에요. 실제 음주는 자유이며 물이나 음료로도 함께할 수 있어요.
          </p>
        </div>
      </section>
    );

  return (
    <section className={cg.stage} aria-label="건배의 눈치">
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
            라운드 {g.round}/{g.settings.rounds}
          </span>
        )}
        {g.stage === "answering" && (
          <span className={cg.dgRound} aria-label={`${total}명 중 ${g.submittedCount}명 제출`}>
            ✋ {g.submittedCount}/{total}명
          </span>
        )}
        {g.stage === "answering" ? (
          <span className={cg.clock} data-urgent={seconds <= 10}>
            <Clock3 size={15} aria-hidden="true" />
            {seconds > 0 ? `${seconds}초` : "집계 중"}
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

      {isQuestioner && g.target !== null && (g.stage === "asking" || g.stage === "answering") && (
        <div className={styles.target}>
          <LockKeyhole size={16} aria-hidden="true" />
          <div>
            <small>나만 보는 목표 · 나도 포함</small>
            <strong>건배 {g.target}명</strong>
          </div>
        </div>
      )}

      {g.stage === "asking" &&
        (isQuestioner ? (
          <form
            className={styles.questionForm}
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim().length >= 5 && !busy)
                onAction({ action: "toast-question", turn: g.turn, question: draft.trim() });
            }}
          >
            <div className={styles.suggestions}>
              <p className={styles.sectionLabel}>✨ 추천 질문 · 누르면 바로 채워져요</p>
              {g.suggestions.map((text) => (
                <button
                  type="button"
                  key={text}
                  disabled={busy}
                  data-picked={draft === text}
                  onClick={() => setDraft(text)}
                >
                  {text}
                </button>
              ))}
            </div>
            <label className={styles.questionField}>
              <span>
                직접 쓰거나 고쳐도 좋아요 <small>{draft.length}/160</small>
              </span>
              <textarea
                aria-label="건배 질문 작성"
                rows={3}
                minLength={5}
                maxLength={160}
                required
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(/[\r\n]+/g, " "))}
                placeholder="예: 나는 여행 전에 일정을 미리 세우는 편이다."
              />
            </label>
            <div className={cg.dgDock}>
              <button
                type="submit"
                className={cg.button}
                disabled={busy || draft.trim().length < 5}
              >
                <Send size={16} aria-hidden="true" />
                질문 공개하기
              </button>
            </div>
          </form>
        ) : (
          <div className={styles.preview}>
            <p className={styles.sectionLabel}>질문이 나오면 이렇게 골라요</p>
            <div>
              <span>
                🥂 <b>건배</b> 나도 그래요
              </span>
              <span>
                🙅 <b>패스</b> 나는 아니에요
              </span>
            </div>
            <small>
              <LockKeyhole size={13} aria-hidden="true" /> 누가 건배했는지는 공개되지 않아요
            </small>
          </div>
        ))}

      {g.stage === "answering" && (
        <>
          <div className={styles.questionCard}>
            <small>{who(g.questionerId)}의 질문</small>
            <h2>{g.question}</h2>
            <div className={styles.progress} aria-hidden="true">
              <i style={{ width: `${(g.submittedCount / Math.max(1, total)) * 100}%` }} />
            </div>
          </div>
          {playing && (
            <>
              <div className={styles.choices} role="group" aria-label="나의 건배 선택">
                <button
                  type="button"
                  aria-pressed={own === true}
                  disabled={locked}
                  onClick={() => setCheers(true)}
                >
                  <span aria-hidden="true">🥂</span>
                  <strong>건배</strong>
                  <small>나도 그래요</small>
                </button>
                <button
                  type="button"
                  aria-pressed={own === false}
                  disabled={locked}
                  onClick={() => setCheers(false)}
                >
                  <span aria-hidden="true">🙅</span>
                  <strong>패스</strong>
                  <small>나는 아니에요</small>
                </button>
              </div>
              {needsPrediction && (
                <div className={styles.prediction}>
                  <p className={styles.sectionLabel}>나를 포함해 몇 명이 건배할까요?</p>
                  <div role="group" aria-label="예상 건배 인원">
                    {Array.from({ length: total + 1 }, (_, i) => (
                      <button
                        key={i}
                        type="button"
                        aria-pressed={(g.myAnswer?.prediction ?? prediction) === i}
                        disabled={locked}
                        onClick={() => setPrediction(i)}
                      >
                        {i}명
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!g.mySubmitted && (
                <div className={cg.dgDock}>
                  <button
                    type="button"
                    className={cg.button}
                    disabled={!canSubmit}
                    onClick={() => {
                      if (canSubmit)
                        onAction({
                          action: "toast-answer",
                          turn: g.turn,
                          cheers: own,
                          ...(needsPrediction ? { prediction } : {}),
                        });
                    }}
                  >
                    <Send size={16} aria-hidden="true" />
                    선택 제출하기
                  </button>
                  <small className={styles.dockHint}>
                    {own === null
                      ? "건배 또는 패스를 먼저 골라주세요"
                      : needsPrediction && prediction === null
                        ? "예상 인원도 골라주세요"
                        : "제출하면 바꿀 수 없어요 · 시간이 끝나면 자동 패스"}
                  </small>
                </div>
              )}
            </>
          )}
        </>
      )}

      {g.stage === "review" && latest && (
        <div className={styles.review}>
          <h2>
            {latest.outcome === "skipped"
              ? "이번 질문은 쉬어가요"
              : latest.points
                ? "눈치 적중!"
                : "아쉽게 빗나갔어요"}
          </h2>
          <p className={styles.reviewQuestion}>
            {latest.question ?? `${name(latest.questionerId)}님의 차례를 건너뛰었어요.`}
          </p>
          {latest.actual !== null && (
            <>
              <div className={styles.glasses} aria-label={`${total}명 중 ${latest.actual}명 건배`}>
                {Array.from({ length: total }, (_, i) => (
                  <span key={i} data-on={i < latest.actual!} aria-hidden="true">
                    <GlassWater size={20} />
                  </span>
                ))}
              </div>
              <div className={styles.counts}>
                <div>
                  <small>{basic ? `${name(latest.questionerId)}님 예상` : "목표"}</small>
                  <strong>{latest.expected === null ? "미제출" : `${latest.expected}명`}</strong>
                </div>
                <span aria-hidden="true">{latest.points ? "=" : "≠"}</span>
                <div>
                  <small>실제 건배</small>
                  <strong>{latest.actual}명</strong>
                </div>
              </div>
              <p className={styles.points}>
                {who(latest.questionerId)} <b>+{latest.points}점</b>
              </p>
            </>
          )}
          {latest.automaticPasses > 0 && (
            <p className={styles.note}>
              미응답 {latest.automaticPasses}명은 자동 패스했어요. 누구인지는 공개하지 않아요.
            </p>
          )}
        </div>
      )}

      {g.stage === "asking" && room.isHost && !isQuestioner && (
        <button
          type="button"
          className={cg.secondary}
          disabled={busy}
          onClick={() => {
            if (window.confirm("질문 준비가 어려운 참가자의 차례를 0점으로 건너뛸까요?"))
              hostAction("toast-skip");
          }}
        >
          <SkipForward size={15} aria-hidden="true" />
          질문 차례 건너뛰기
        </button>
      )}
      {g.stage === "review" && room.isHost && (
        <div className={cg.dgDock}>
          <button
            type="button"
            className={cg.button}
            disabled={busy}
            onClick={() => hostAction("toast-next")}
          >
            다음 질문으로
          </button>
        </div>
      )}

      {finished && (
        <div className={styles.final}>
          <span aria-hidden="true">{g.stage === "aborted" ? "👋" : "🏆"}</span>
          <h2>
            {g.stage === "aborted"
              ? "게임을 중단했어요"
              : `${g.winners.map(name).join(" · ")} ${g.winners.length > 1 ? "공동 1등!" : "1등!"}`}
          </h2>
          <p>
            {g.stage === "aborted"
              ? "완료한 차례의 점수만 남겨요. 진행 중이던 개인 선택은 지웠어요."
              : "서로의 생각을 얼마나 잘 읽었나요? 이제 마지막 한마디를 나눠보세요."}
          </p>
        </div>
      )}

      {(finished || g.stage === "review") && <CreativeScores players={g.roster} self={me} />}

      {g.stage === "result" && (
        <section className={styles.lastWord}>
          <div className={styles.lastHeading}>
            <MessageCircle size={20} aria-hidden="true" />
            <div>
              <h3>마지막 한마디</h3>
              <p>
                1등이 궁금했던 선택을 물어봐요. 지목받은 사람은 말로 대답해요. 점수는 바뀌지 않아요.
              </p>
            </div>
          </div>
          {isWinner && !sentLast && g.history.some((h) => h.question !== null) && (
            <form
              className={styles.lastForm}
              onSubmit={(e) => {
                e.preventDefault();
                if (lastTarget && lastTurn && !busy)
                  onAction({
                    action: "toast-last-word",
                    turn: Number(lastTurn),
                    targetId: lastTarget,
                  });
              }}
            >
              <label>
                누구에게 물어볼까요?
                <select
                  aria-label="마지막 한마디 참가자"
                  required
                  value={lastTarget}
                  onChange={(e) => setLastTarget(e.target.value)}
                >
                  <option value="">참가자 선택</option>
                  {g.roster
                    .filter((p) => p.id !== me)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nickname}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                어떤 질문이 궁금했나요?
                <select
                  aria-label="마지막 한마디 질문"
                  required
                  value={lastTurn}
                  onChange={(e) => setLastTurn(e.target.value)}
                >
                  <option value="">질문 선택</option>
                  {g.history
                    .filter((h) => h.question !== null)
                    .map((h) => (
                      <option key={h.turn} value={h.turn}>
                        {h.turn}. {h.question}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="submit"
                className={cg.button}
                disabled={busy || !lastTarget || !lastTurn}
              >
                마지막 한마디 보내기
              </button>
            </form>
          )}
          {g.lastWords.map((word) => (
            <article key={word.fromId} className={styles.conversation}>
              <small>
                {name(word.fromId)} → {name(word.targetId)}
              </small>
              <p>
                “{word.question}”<br />이 질문에 건배였나요, 패스였나요?
              </p>
              <span>직접 이야기해요. 개인의 선택은 화면에서 공개하지 않아요.</span>
            </article>
          ))}
          {g.winners.length > 1 && (
            <p className={styles.note}>공동 1등은 순서를 정해 한 명씩 질문해요.</p>
          )}
        </section>
      )}

      {g.history.length > 0 && (
        <details className={styles.history}>
          <summary>지나간 질문 {g.history.length}개 보기</summary>
          {[...g.history].reverse().map((h) => (
            <div key={h.turn}>
              <small>
                {h.round}라운드 · {name(h.questionerId)}
              </small>
              <p>{h.question ?? "질문 차례 건너뛰기"}</p>
              <span>
                {h.actual === null
                  ? "건너뜀"
                  : `${basic ? "예상" : "목표"} ${h.expected ?? "미제출"}${h.expected === null ? "" : "명"} · 실제 ${h.actual}명`}{" "}
                <b>+{h.points}점</b>
              </span>
            </div>
          ))}
        </details>
      )}
      <p className={styles.safety}>
        <LockKeyhole size={13} aria-hidden="true" /> 개인 선택은 결과·지난 질문·마지막 한마디에서도
        공개하지 않아요. 건배 버튼은 음주 의무를 뜻하지 않아요.
      </p>
    </section>
  );
}
