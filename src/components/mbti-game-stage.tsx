"use client";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Fingerprint, Mic2, Vote, Trophy, ArrowRight } from "lucide-react";
import { WORD_CATEGORIES, WORD_MODE_LABELS } from "@/domain/word-liar";
import { MBTI_TYPES } from "@/domain/mbti-game";
import type { GameRoomView } from "@/domain/game-room";
import styles from "./mbti-game-stage.module.css";
export function MbtiGameStage({
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
  const game = room.mbti!;
  const isWord = !!game.words,
    category = WORD_CATEGORIES.find((c) => c.id === game.words?.category)?.label;
  const [reveal, setReveal] = useState(false),
    [target, setTarget] = useState<string | null>(null),
    [guess, setGuess] = useState<string>("");
  const [seconds, setSeconds] = useState(30);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    setTarget(null);
    setGuess("");
  }, [game.cycle, game.stage]);
  useEffect(() => {
    if (game.endsAt === null) return;
    const offset = game.serverNow - Date.now();
    let requested = false;
    const tick = () => {
      const left = Math.max(0, Math.ceil((game.endsAt! - Date.now() - offset) / 1000));
      setSeconds(left);
      if (left === 0 && !requested) {
        requested = true;
        refresh.current();
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [game.endsAt, game.serverNow]);
  const name = (id: string | null) => game.roster.find((p) => p.id === id)?.nickname ?? "참가자";
  const titles = {
    lobby: "같은 성향, 다른 한 사람",
    acting: isWord ? "제시어를 자연스럽게 설명해요" : "이 상황이라면, 당신은?",
    voting: isWord ? "누가 라이어처럼 느껴졌나요?" : "누가 다르게 연기했나요?",
    tally: "모두의 선택을 확인해요",
    guess: "라이어의 마지막 추리",
    result: isWord ? "모두의 제시어를 확인해요" : "위장이 끝났어요",
    aborted: "게임을 중단했어요",
  };
  const hostAction = (action: string) => onAction({ action, revision: room.revision }, true);
  return (
    <section
      className={styles.stage}
      aria-label={isWord ? "제시어 라이어 게임" : isWord ? "제시어 라이어 게임" : "MBTI 위장 게임"}
    >
      <header className={styles.heading}>
        <span>
          <Fingerprint size={18} /> {isWord ? "LIAR GAME" : "MBTI UNDERCOVER"}
        </span>
        <small>
          {game.words
            ? `${category} · ${WORD_MODE_LABELS[game.words.mode]}`
            : game.revealLiar
              ? "정체 공개 모드"
              : "정체 비공개 모드"}{" "}
          · {isWord ? "설명" : "상황"} {game.cycle || 1}
        </small>
      </header>
      <div className={styles.layout}>
        <div className={styles.public}>
          <span className={styles.kicker}>
            {game.stage === "acting"
              ? "SCENE " + String(game.cycle).padStart(2, "0")
              : isWord
                ? "제시어 라이어 게임"
                : "MBTI 위장 게임"}
          </span>
          <h2>{titles[game.stage]}</h2>
          {game.stage === "lobby" ? (
            <p>
              같은 MBTI를 연기하는 사람들 속 다른 한 사람을 찾아보세요. 실제 성격이 아닌, 여러분만의
              해석으로 연기하면 돼요.
            </p>
          ) : game.stage === "aborted" ? (
            <p>정답은 공개하지 않았어요. 호스트가 다음 게임을 준비할 수 있어요.</p>
          ) : (
            <blockquote>{game.scenario}</blockquote>
          )}
          {game.stage === "acting" && (
            <div className={styles.turn}>
              <div>
                <Mic2 size={20} />
                <span>
                  <small>{isWord ? "지금 설명할 사람" : "지금 연기할 사람"}</small>
                  <strong>
                    {name(game.speakerId)}
                    {game.speakerId === room.viewer.id ? " · 내 차례" : ""}
                  </strong>
                </span>
              </div>
              <strong className={styles.timer} aria-label="남은 발언 시간">
                {String(seconds).padStart(2, "0")}
                <small>초</small>
              </strong>
              <div className={styles.track}>
                <i style={{ width: `${(seconds / 30) * 100}%` }} />
              </div>
            </div>
          )}
          {game.stage !== "lobby" && (
            <ol className={styles.order} aria-label="발언 순서">
              {game.roster.map((p, i) => (
                <li key={p.id} data-active={p.id === game.speakerId}>
                  <span>{i + 1}</span>
                  {p.nickname}
                  {p.id === room.viewer.id && <small>나</small>}
                </li>
              ))}
            </ol>
          )}
          {game.stage === "voting" && (
            <div className={styles.votePanel}>
              <div className={styles.progressTitle}>
                <strong>
                  <Vote size={17} /> 비공개 투표
                </strong>
                <span>
                  {game.voteCount}/{game.roster.length}명 완료
                </span>
              </div>
              <p>과반수 {game.majority}표가 필요해요. 잘못 지목돼도 탈락하지 않아요.</p>
              {room.isHost ? (
                <button
                  disabled={busy}
                  onClick={() => {
                    if (confirm("아직 투표하지 않은 표는 기권으로 처리하고 집계할까요?"))
                      hostAction("mbti-tally");
                  }}
                >
                  현재 표로 집계하기
                </button>
              ) : game.hasVoted ? (
                <p className={styles.notice}>
                  투표했어요.{" "}
                  {game.myVote ? name(game.myVote) + " 님을 선택했어요." : "기권했어요."} 결과를
                  기다려주세요.
                </p>
              ) : (
                <>
                  <div className={styles.choices}>
                    {game.roster
                      .filter((p) => p.id !== room.viewer.id)
                      .map((p) => (
                        <button
                          key={p.id}
                          aria-pressed={target === p.id}
                          onClick={() => setTarget(p.id)}
                        >
                          {p.nickname}
                        </button>
                      ))}
                  </div>
                  <div className={styles.actions}>
                    <button
                      className={styles.primary}
                      disabled={busy || !target}
                      onClick={() => onAction({ action: "mbti-vote", cycle: game.cycle, target })}
                    >
                      선택한 사람에게 투표
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        onAction({ action: "mbti-vote", cycle: game.cycle, target: null })
                      }
                    >
                      기권하기
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {(game.stage === "tally" || game.stage === "guess") && (
            <div className={styles.verdict}>
              <strong>
                {game.tally?.outcome === "no-majority"
                  ? "과반수로 지목된 사람이 없어요"
                  : game.tally?.outcome === "wrong"
                    ? `${name(game.tally.suspect)} 님은 라이어가 아니에요`
                    : `라이어는 ${name(game.liarId)} 님!`}
              </strong>
              <p>
                {game.stage === "guess"
                  ? "라이어가 다른 사람들의 공통 제시어를 한 번 추리해요. 맞히면 라이어 승리!"
                  : "탈락 없이 모두 다음 상황에 참여해요."}
              </p>
              {game.stage === "tally" && room.isHost && (
                <button
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => hostAction("mbti-next")}
                >
                  {isWord ? "다음 설명 시작" : "다음 상황 시작"} <ArrowRight size={16} />
                </button>
              )}
            </div>
          )}
          {game.stage === "guess" && game.canGuess && (
            <form
              className={styles.guess}
              onSubmit={(e) => {
                e.preventDefault();
                if (guess && confirm(`${guess}로 최종 제출할까요? 한 번만 추리할 수 있어요.`))
                  onAction({
                    action: isWord ? "word-guess" : "mbti-guess",
                    cycle: game.cycle,
                    guess,
                  });
              }}
            >
              <label>
                {isWord ? "공통 제시어 정답" : "다른 참가자들의 공통 MBTI"}
                {isWord ? (
                  <input
                    aria-label="공통 제시어 정답"
                    required
                    maxLength={40}
                    autoComplete="off"
                    placeholder="공통 제시어를 입력해주세요"
                    value={guess}
                    onChange={(e) => setGuess(e.target.value)}
                  />
                ) : (
                  <select
                    aria-label="다른 참가자들의 공통 MBTI"
                    required
                    value={guess}
                    onChange={(e) => setGuess(e.target.value)}
                  >
                    <option value="">MBTI를 선택해주세요</option>
                    {MBTI_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                )}
              </label>
              <button className={styles.primary} disabled={busy || !guess.trim()}>
                마지막 추리 제출
              </button>
            </form>
          )}
          {game.result && (
            <div className={styles.result}>
              <Trophy size={32} />
              <h3>{game.result.winner === "liar" ? "라이어 승리!" : "일반 참가자 승리!"}</h3>
              <p>
                {name(game.liarId)} 님의 마지막 추리: <b>{game.result.guess}</b>
              </p>
              <div>
                <span>
                  {isWord ? "공통 제시어" : "공통 MBTI"}
                  <strong>{game.result.common}</strong>
                </span>
                <span>
                  라이어의 제시어
                  <strong>{game.words?.mode === "classic" ? "없음" : game.result.odd}</strong>
                </span>
              </div>
            </div>
          )}
        </div>
        {game.assignment && game.stage !== "result" && game.stage !== "aborted" && (
          <aside className={styles.private}>
            <Fingerprint size={26} />
            <span>나만 보는 제시어</span>
            <h3>{reveal ? game.assignment : "••••"}</h3>
            <button aria-expanded={reveal} onClick={() => setReveal((v) => !v)}>
              {reveal ? <EyeOff size={16} /> : <Eye size={16} />}{" "}
              {reveal ? "다시 가리기" : "제시어 확인"}
            </button>
            {reveal && game.isLiar !== null && (
              <strong>{game.isLiar ? "당신은 라이어예요" : "당신은 일반 참가자예요"}</strong>
            )}
            <p>
              {isWord ? (
                game.isLiar && game.words?.mode === "classic" ? (
                  "다른 사람들의 설명을 듣고 제시어를 추리해보세요."
                ) : (
                  "제시어를 직접 말하지 말고 특징이나 경험으로 설명해주세요."
                )
              ) : (
                <>
                  MBTI를 직접 말하지 말고
                  <br />그 성향을 자유롭게 연기해주세요.
                </>
              )}
            </p>
          </aside>
        )}
      </div>
    </section>
  );
}
