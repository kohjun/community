"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleHelp,
  Clock3,
  GlassWater,
  LockKeyhole,
  MessageCircle,
  PartyPopper,
  SkipForward,
  Sparkles,
  Trophy,
} from "lucide-react";
import type { GameRoomView } from "@/domain/game-room";
import styles from "./toast-game-stage.module.css";
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
    isQuestioner = me !== null && me === g.questionerId;
  const [draft, setDraft] = useState(""),
    [cheers, setCheers] = useState<boolean | null>(null),
    [prediction, setPrediction] = useState(""),
    [seconds, setSeconds] = useState(0),
    [lastTarget, setLastTarget] = useState(""),
    [lastTurn, setLastTurn] = useState("");
  const refresh = useRef(onRefresh),
    refreshed = useRef<number | null>(null);
  refresh.current = onRefresh;
  useEffect(() => {
    setDraft("");
    setCheers(null);
    setPrediction("");
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
  const hostAction = (action: string) =>
    onAction({ action, revision: room.revision, turn: g.turn }, true);
  const latest = g.history.at(-1),
    isWinner = me !== null && g.winners.includes(me),
    sentLast = !!g.lastWords.find((v) => v.fromId === me);
  const own = g.myAnswer?.cheers ?? cheers,
    needsPrediction = isQuestioner && g.settings.mode === "basic";
  const locked = busy || g.mySubmitted || seconds === 0;
  const canSubmit = own !== null && (!needsPrediction || prediction !== "") && !locked;
  const finished = g.stage === "result" || g.stage === "aborted";
  if (g.stage === "lobby")
    return (
      <section className={styles.prepare} aria-label="건배의 눈치 안내">
        <span className={styles.logo}>
          <GlassWater size={26} />
        </span>
        <div>
          <h2>건배의 눈치</h2>
          <p>
            {g.settings.mode === "basic"
              ? "건배를 선택할 인원을 맞히는 눈치게임"
              : "목표 인원에 딱 맞는 질문을 만드는 눈치게임"}
          </p>
          <div className={styles.tags}>
            <span>{g.settings.mode === "basic" ? "기본 모드" : "심화 모드"}</span>
            <span>모두 한 번씩 질문하면 1라운드</span>
            <span>선택 {g.settings.answerSeconds}초</span>
            <span>개인 선택 비공개</span>
          </div>
          <p className={styles.note}>
            ‘건배’는 질문에 대한 선택이에요. 실제 음주는 자유이며 물이나 음료로도 함께할 수 있어요.
          </p>
        </div>
      </section>
    );
  return (
    <section className={styles.stage} aria-label="건배의 눈치">
      <header className={styles.header}>
        <span>
          <GlassWater size={19} /> 건배의 눈치{" "}
          <small>{g.settings.mode === "basic" ? "기본" : "심화"}</small>
        </span>
        <span>
          {g.round} / {g.settings.rounds} 라운드{" "}
          <small>
            · {g.turn} / {g.totalTurns} 차례
          </small>
        </span>
      </header>
      <div className={styles.body}>
        {!finished && (
          <div className={styles.steps}>
            <span data-active={g.stage === "asking"}>01 질문 만들기</span>
            <ArrowRight size={12} />
            <span data-active={g.stage === "answering"}>02 비공개 선택</span>
            <ArrowRight size={12} />
            <span data-active={g.stage === "review"}>03 인원 공개</span>
          </div>
        )}
        {g.stage === "asking" ? (
          <div className={styles.playGrid}>
            <div className={styles.questionCard}>
              <span className={styles.eyebrow}>YOUR QUESTION, OUR CHEERS</span>
              <span className={styles.questionIcon}>
                <MessageCircle size={32} />
              </span>
              <p className={styles.label}>이번 질문자</p>
              <h2>
                {name(g.questionerId)}
                {isQuestioner ? " · 나" : ""}
              </h2>
              <p>
                {g.settings.mode === "basic"
                  ? "모두의 생각을 읽을 질문 하나를 골라주세요."
                  : "목표 인원에 딱 맞을 질문을 만들어주세요."}
              </p>
              <div className={styles.privacy}>
                <LockKeyhole size={15} /> 누가 건배·패스했는지는 공개하지 않아요
              </div>
            </div>
            <div className={styles.controls}>
              {isQuestioner ? (
                <>
                  {g.target !== null && (
                    <div className={styles.target}>
                      <LockKeyhole size={15} />
                      <div>
                        <small>나에게만 보이는 목표 · 나도 포함</small>
                        <strong>건배 {g.target}명</strong>
                      </div>
                    </div>
                  )}
                  <form
                    className={styles.questionForm}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (draft.trim().length >= 5 && !busy)
                        onAction({
                          action: "toast-question",
                          turn: g.turn,
                          question: draft.trim(),
                        });
                    }}
                  >
                    <label>
                      질문 작성
                      <textarea
                        aria-label="건배 질문 작성"
                        rows={3}
                        minLength={5}
                        maxLength={160}
                        required
                        value={draft}
                        onChange={(e) => setDraft(e.target.value.replace(/[\r\n]+/g, " "))}
                        placeholder="나는 여행 전에 일정을 미리 세우는 편이다."
                      />
                    </label>
                    <small className={styles.characterCount}>{draft.length} / 160</small>
                    <button
                      type="submit"
                      className={styles.primary}
                      disabled={busy || draft.trim().length < 5}
                    >
                      질문 공개하기 <ArrowRight size={16} />
                    </button>
                  </form>
                  <div className={styles.suggestions}>
                    <h3>
                      <Sparkles size={15} /> 이런 질문은 어때요?
                    </h3>
                    {g.suggestions.map((text) => (
                      <button
                        type="button"
                        key={text}
                        disabled={busy}
                        onClick={() => setDraft(text)}
                      >
                        {text}
                        <ArrowRight size={13} />
                      </button>
                    ))}
                    <p>질문을 누르면 입력창에 채워져요. 수정한 뒤 공개해도 좋아요.</p>
                  </div>
                </>
              ) : (
                <div className={styles.waiting}>
                  <CircleHelp size={30} />
                  <h3>어떤 질문이 나올까요?</h3>
                  <p>
                    {name(g.questionerId)} 님이 질문을 고르고 있어요.
                    <br />
                    질문이 공개되면 건배 또는 패스를 선택해요.
                  </p>
                  {room.isHost && (
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm("질문 준비가 어려운 참가자의 차례를 0점으로 건너뛸까요?")
                        )
                          hostAction("toast-skip");
                      }}
                    >
                      <SkipForward size={15} /> 질문 차례 건너뛰기
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : g.stage === "answering" ? (
          <div className={styles.playGrid}>
            <div className={styles.questionCard}>
              <span className={styles.questionTop}>
                <span>{name(g.questionerId)}의 질문</span>
                <span className={styles.clock} data-urgent={seconds <= 10}>
                  <Clock3 size={15} />
                  {seconds > 0 ? `${seconds}초` : "집계 중"}
                </span>
              </span>
              <span className={styles.questionIcon}>
                <GlassWater size={33} />
              </span>
              <h2 className={styles.questionText}>{g.question}</h2>
              <div className={styles.progress}>
                <i
                  style={{ width: `${(g.submittedCount / Math.max(1, g.roster.length)) * 100}%` }}
                />
              </div>
              <p>
                {g.submittedCount} / {g.roster.length}명 제출
              </p>
              <div className={styles.privacy}>
                <LockKeyhole size={15} /> 전체 인원만 공개 · 미응답은 자동 패스
              </div>
            </div>
            <div className={styles.controls}>
              {room.isHost ? (
                <div className={styles.waiting}>
                  <LockKeyhole size={28} />
                  <h3>모두의 선택을 기다려요</h3>
                  <p>
                    진행자도 개인의 선택과 기본 모드의 예측을 볼 수 없어요. 전원 제출 또는 시간 종료
                    시 자동으로 공개돼요.
                  </p>
                </div>
              ) : (
                <>
                  {isQuestioner && g.target !== null && (
                    <div className={styles.target}>
                      <LockKeyhole size={15} />
                      <div>
                        <small>이번 목표 · 나도 포함</small>
                        <strong>건배 {g.target}명</strong>
                      </div>
                    </div>
                  )}
                  <h3>나의 선택은?</h3>
                  <p className={styles.helper}>
                    질문자도 꼭 함께 선택해요. 제출 후에는 바꿀 수 없어요.
                  </p>
                  <div className={styles.choices} role="group" aria-label="나의 건배 선택">
                    <button
                      type="button"
                      aria-pressed={own === true}
                      disabled={locked}
                      onClick={() => setCheers(true)}
                    >
                      <GlassWater size={27} />
                      <strong>건배</strong>
                      <small>나도 그래요</small>
                    </button>
                    <button
                      type="button"
                      aria-pressed={own === false}
                      disabled={locked}
                      onClick={() => setCheers(false)}
                    >
                      <span className={styles.passIcon}>—</span>
                      <strong>패스</strong>
                      <small>나는 아니에요</small>
                    </button>
                  </div>
                  {needsPrediction && (
                    <label className={styles.prediction}>
                      나를 포함해 총 몇 명이 건배할까요?
                      <select
                        aria-label="예상 건배 인원"
                        disabled={locked}
                        value={g.myAnswer?.prediction?.toString() ?? prediction}
                        onChange={(e) => setPrediction(e.target.value)}
                      >
                        <option value="">예상 인원 선택</option>
                        {Array.from({ length: g.roster.length + 1 }, (_, i) => (
                          <option key={i} value={i}>
                            {i}명
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {g.mySubmitted ? (
                    <p className={styles.submitted} role="status">
                      <Check size={17} /> {g.myAnswer?.cheers ? "건배" : "패스"}로 제출했어요. 다른
                      사람의 선택을 기다려요.
                    </p>
                  ) : (
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={!canSubmit}
                      onClick={() => {
                        if (canSubmit)
                          onAction({
                            action: "toast-answer",
                            turn: g.turn,
                            cheers: own,
                            ...(needsPrediction ? { prediction: Number(prediction) } : {}),
                          });
                      }}
                    >
                      선택 제출하기 <ArrowRight size={16} />
                    </button>
                  )}
                  <p className={styles.note}>
                    시간이 끝나면 미응답은 패스로 처리돼요.
                    {needsPrediction ? " 예상 인원을 내지 못하면 이번 차례는 0점이에요." : ""}
                  </p>
                </>
              )}
            </div>
          </div>
        ) : g.stage === "review" && latest ? (
          <div className={styles.review}>
            <span className={styles.resultMark}>
              {latest.points ? <PartyPopper size={32} /> : <GlassWater size={32} />}
            </span>
            <span className={styles.eyebrow}>THE CHEERS COUNT</span>
            <h2>
              {latest.outcome === "skipped"
                ? "이번 질문은 쉬어가요"
                : latest.points
                  ? "눈치 적중!"
                  : "다음 질문을 기대해요"}
            </h2>
            <p>{latest.question ?? `${name(latest.questionerId)} 님의 차례를 건너뛰었어요.`}</p>
            {latest.actual !== null && (
              <div className={styles.counts}>
                <div>
                  <small>{g.settings.mode === "target" ? "목표 건배" : "질문자의 예상"}</small>
                  <strong>{latest.expected === null ? "미제출" : `${latest.expected}명`}</strong>
                </div>
                <ArrowRight size={20} />
                <div>
                  <small>실제 건배</small>
                  <strong>{latest.actual}명</strong>
                </div>
              </div>
            )}
            <div className={styles.points}>
              {name(latest.questionerId)} <b>+{latest.points}점</b>
            </div>
            {latest.automaticPasses > 0 && (
              <p className={styles.note}>
                미응답 {latest.automaticPasses}명은 자동 패스했어요. 누구인지는 공개하지 않아요.
              </p>
            )}
            {room.isHost ? (
              <button
                type="button"
                className={styles.primary}
                disabled={busy}
                onClick={() => hostAction("toast-next")}
              >
                다음 질문으로 <ArrowRight size={16} />
              </button>
            ) : (
              <p className={styles.helper}>진행자가 다음 질문을 열면 이어서 플레이해요.</p>
            )}
          </div>
        ) : (
          <div className={styles.review}>
            <span className={styles.resultMark}>
              <Trophy size={32} />
            </span>
            <span className={styles.eyebrow}>
              {g.stage === "aborted" ? "SEE YOU NEXT TIME" : "THE FINAL CHEERS"}
            </span>
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
        {g.roster.length > 0 && (
          <section className={styles.scoreboard} aria-label="건배의 눈치 점수">
            <h3>
              {finished ? "최종 점수" : "지금까지의 점수"}
              <small>정확히 맞히면 질문자 +1점</small>
            </h3>
            <ol>
              {g.roster.map((p) => (
                <li key={p.id}>
                  <span className={styles.rank}>{p.rank}</span>
                  <span>
                    {p.nickname}
                    {p.id === me ? <small> · 나</small> : null}
                  </span>
                  {!finished && p.id === g.questionerId && (
                    <small className={styles.questioner}>질문자</small>
                  )}
                  <strong>
                    {p.score}
                    <small>점</small>
                  </strong>
                </li>
              ))}
            </ol>
          </section>
        )}
        {g.stage === "result" && (
          <section className={styles.lastWord}>
            <div className={styles.lastHeading}>
              <MessageCircle size={20} />
              <div>
                <h3>마지막 한마디</h3>
                <p>
                  1등이 궁금했던 선택을 물어봐요. 지목받은 사람은 말로 대답해요. 점수는 바뀌지
                  않아요.
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
                  className={styles.primary}
                  disabled={busy || !lastTarget || !lastTurn}
                >
                  마지막 한마디 보내기 <ArrowRight size={16} />
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
                    : `${g.settings.mode === "target" ? "목표" : "예상"} ${h.expected ?? "미제출"}${h.expected === null ? "" : "명"} · 실제 ${h.actual}명`}{" "}
                  <b>+{h.points}점</b>
                </span>
              </div>
            ))}
          </details>
        )}
        <p className={styles.safety}>
          <LockKeyhole size={13} /> 개인 선택은 결과·지난 질문·마지막 한마디에서도 공개하지 않아요.
          건배 버튼은 음주 의무를 뜻하지 않아요.
        </p>
      </div>
    </section>
  );
}
