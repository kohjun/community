"use client";
import { useEffect, useRef, useState, useId } from "react";
import { Dices, Hourglass, Send, ThumbsUp } from "lucide-react";
import type { GameRoomView } from "@/domain/game-room";
import { DRAWING_MODES, type DrawingChain, type DrawingView } from "@/domain/creative-games";
import { uploadGameMedia } from "@/lib/game-media-client";
import { GameCanvas, type CanvasHandle } from "./game-canvas";
import {
  CreativeClock,
  CreativeControls,
  CreativeScores,
  CreativeWinners,
  type CreativeAction,
} from "./creative-game-common";
import styles from "./creative-games.module.css";

const PROMPT_IDEAS = [
  "떡볶이를 먹는 펭귄",
  "노래방에서 탬버린을 흔드는 고양이",
  "단체 사진에서 혼자 눈을 감은 토끼",
  "지하철에서 졸다가 내릴 역을 지나친 곰",
  "비 오는 날 우산을 뒤집어 쓴 강아지",
  "케이크 위에서 서핑하는 햄스터",
];

/** What the viewer should do right now, shown as the big card at the top. */
type Task = { emoji: string; title: string; detail: string; tone: "act" | "wait" | "watch" };

/** Which of the mode's steps is happening (for the step bar), or -1 when none applies. */
function stepIndex(game: DrawingView, drawingNow: boolean) {
  const { mode } = game.settings;
  if (mode === "live") return game.stage === "review" ? 2 : drawingNow ? 0 : 1;
  switch (game.stage) {
    case "prompt":
      return 0;
    case "draw":
      return 1;
    case "interpret":
      return 2;
    case "live":
    case "judging":
    case "gallery":
      return 3;
    case "review":
    case "voting":
      return 4;
    default:
      return -1;
  }
}

export function DrawingGameStage({
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
  const uid = useId();
  const game = room.drawing!,
    self = room.viewer.id,
    mode = DRAWING_MODES[game.settings.mode],
    canvas = useRef<CanvasHandle>(null),
    [text, setText] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    setText("");
    setError("");
  }, [game.phaseId]);
  const src = (id: string) => `/api/games/${room.id}/media/${id}${room.isHost ? "?host=1" : ""}`;
  const act = (action: Record<string, unknown>) =>
    onAction({ ...action, runId: game.runId, phaseId: game.phaseId });
  const name = (id: string | null) => game.roster.find((p) => p.id === id)?.nickname ?? "참가자";
  // "지연님" / "나": labels put particles only after these, never after a raw nickname.
  const who = (id: string | null) => (id === self ? "나" : `${name(id)}님`);
  async function submitImage() {
    if (saving || busy) return;
    setSaving(true);
    setError("");
    try {
      const image = await canvas.current?.image();
      if (!image) throw new Error("그림판을 확인해주세요.");
      const asset = await uploadGameMedia(room.id, room.isHost, image, "drawing", game.phaseId);
      await act({ action: "drawing-image", assetId: asset.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "그림을 전달하지 못했어요.");
    } finally {
      setSaving(false);
    }
  }

  const finished = ["result", "aborted"].includes(game.stage),
    submitPhase = ["prompt", "draw", "interpret"].includes(game.stage),
    writing = (game.stage === "prompt" || game.stage === "interpret") && !!game.assignment,
    drawingNow = (game.stage === "draw" || game.stage === "live") && !!game.assignment,
    watchingLive =
      ["live", "judging"].includes(game.stage) &&
      !!game.liveCanvasId &&
      (!game.assignment || game.stage === "judging"),
    scored = game.settings.scored && game.settings.mode !== "relay",
    artist = who(game.artistId);

  const task: Task = finished
    ? {
        emoji: "🏁",
        title: "게임 끝!",
        detail: scored
          ? "최종 점수와 우리가 만든 그림을 함께 봐요."
          : "완성된 이야기를 함께 감상해요.",
        tone: "watch",
      }
    : game.paused
      ? {
          emoji: "⏸️",
          title: "잠깐 쉬는 중",
          detail: "진행자가 다시 시작하면 이어서 해요.",
          tone: "wait",
        }
      : game.stage === "prompt"
        ? game.submitted
          ? {
              emoji: "✅",
              title: "문장을 넘겼어요",
              detail: "모두 쓰면 그리기로 넘어가요.",
              tone: "wait",
            }
          : {
              emoji: "✍️",
              title: "다른 사람이 그릴 문장을 써주세요",
              detail: "그리기 애매하고 엉뚱할수록 결과가 웃겨요.",
              tone: "act",
            }
        : game.stage === "draw"
          ? game.submitted
            ? {
                emoji: "✅",
                title: "그림을 넘겼어요",
                detail: "다음 사람은 이 그림만 보고 무슨 장면인지 맞혀 써요.",
                tone: "wait",
              }
            : {
                emoji: "🎨",
                title: "이 문장을 그림으로 그려주세요",
                detail: "글자나 숫자는 쓰지 말고 그림으로만! 다음 사람은 그림만 봐요.",
                tone: "act",
              }
          : game.stage === "interpret"
            ? game.submitted
              ? {
                  emoji: "✅",
                  title: "문장을 넘겼어요",
                  detail: "모두 쓰면 다 같이 볼 차례예요.",
                  tone: "wait",
                }
              : {
                  emoji: "🔍",
                  title: "이 그림은 무슨 장면일까요?",
                  detail: "그림만 보고 떠오르는 장면을 한 문장으로 써주세요.",
                  tone: "act",
                }
            : game.stage === "live"
              ? game.assignment
                ? {
                    emoji: "🎨",
                    title: "모두가 맞히도록 그려주세요",
                    detail:
                      game.settings.mode === "live"
                        ? "그리는 모습이 실시간으로 보여요. 정답이 나오면 나도 1점! 아래에서 비슷한 답을 인정해줄 수 있어요."
                        : "그리는 모습이 실시간으로 보여요. 정답이 나오면 나도 1점!",
                    tone: "act",
                  }
                : game.canJudge
                  ? {
                      emoji: "⚖️",
                      title: "비슷한 답을 인정해주세요",
                      detail:
                        "정답은 내가 쓴 문장이에요. 같은 뜻의 답이 오면 ‘정답 인정’을 눌러요.",
                      tone: "act",
                    }
                  : game.canGuess
                    ? {
                        emoji: "🤔",
                        title: "무엇을 그리는지 맞혀보세요",
                        detail: "먼저 맞히면 2점! 생각나는 대로 여러 번 입력해도 돼요.",
                        tone: "act",
                      }
                    : {
                        emoji: "👀",
                        title: "그림을 지켜봐요",
                        detail: "이번 그림은 지켜보기만 해요. 다음 차례를 기다려요.",
                        tone: "watch",
                      }
              : game.stage === "judging"
                ? game.canJudge
                  ? {
                      emoji: "⚖️",
                      title: "마지막으로 답을 확인해주세요",
                      detail: "새 답은 마감됐어요. 같은 뜻의 답이 있으면 인정해주세요.",
                      tone: "act",
                    }
                  : {
                      emoji: "⏳",
                      title: "정답 확인 중",
                      detail: "비슷한 답이 있는지 확인하고 있어요. 곧 결과가 나와요.",
                      tone: "wait",
                    }
                : game.stage === "voting"
                  ? game.myVote
                    ? {
                        emoji: "✅",
                        title: "투표했어요",
                        detail: "모두 투표하면 결과가 나와요.",
                        tone: "wait",
                      }
                    : {
                        emoji: "🗳️",
                        title: "가장 웃긴 이야기에 한 표!",
                        detail: "내 이야기를 뺀 나머지 중에서 골라주세요.",
                        tone: "act",
                      }
                  : {
                      emoji: "👀",
                      title: game.settings.mode === "live" ? "정답 공개!" : "이렇게 바뀌었어요!",
                      detail:
                        game.settings.mode === "live"
                          ? "누가 맞혔는지 확인하고 다음 차례로 넘어가요."
                          : "처음 문장부터 마지막 그림까지 어떻게 달라졌는지 함께 봐요.",
                      tone: "watch",
                    };

  // Announce each new phase briefly so a glance is enough to know what changed.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (announced.current === null) {
      announced.current = game.phaseId;
      return;
    }
    if (announced.current === game.phaseId) return;
    announced.current = game.phaseId;
    setToast({ id: game.phaseId, text: `${task.emoji} ${task.title}` });
    // `task` follows from the same phase, so the phase id alone decides when to announce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.phaseId]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2_600);
    return () => clearTimeout(timer);
  }, [toast]);

  const current = stepIndex(game, drawingNow);
  const progressLabel = [
    game.settings.sets > 1 ? `${game.set}/${game.settings.sets}바퀴` : null,
    ["live", "judging", "review", "gallery"].includes(game.stage)
      ? `${game.settings.mode === "live" ? "차례" : "이야기"} ${Math.min(game.index + 1, game.roster.length)}/${game.roster.length}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function storyCard(c: DrawingChain) {
    const live = game.settings.mode === "live";
    const steps: { label: string; text?: string | null; image?: string | null }[] = live
      ? [
          { label: "제시어", text: c.prompt },
          ...(c.finalImage
            ? [{ label: `그림 · ${who(c.finalPainter)}`, image: c.finalImage }]
            : []),
        ]
      : [
          { label: `처음 문장 · ${who(c.author)}`, text: c.prompt ?? "문장을 쓰지 못했어요" },
          ...(c.image ? [{ label: `그림 · ${who(c.painter)}`, image: c.image }] : []),
          {
            label: `그림 보고 쓴 문장 · ${who(c.interpreter)}`,
            text: c.interpretation ?? "문장을 쓰지 못했어요",
          },
          ...(c.finalImage
            ? [{ label: `마지막 그림 · ${who(c.finalPainter)}`, image: c.finalImage }]
            : []),
        ];
    return (
      <article key={c.id} className={styles.story}>
        <header>
          <strong>{live ? `${who(c.finalPainter)}의 차례` : `${who(c.author)}의 이야기`}</strong>
          {c.winner ? (
            <span data-tone="win">
              🎉 {c.winner === self ? "내가 맞혔어요!" : `${who(c.winner)} 정답!`}
            </span>
          ) : !c.skipped && game.settings.mode !== "relay" && game.stage !== "voting" ? (
            <span data-tone="miss">아무도 못 맞혔어요</span>
          ) : null}
        </header>
        <ol>
          {steps.map((step, index) => (
            <li key={step.label}>
              <b>{index + 1}</b>
              <div>
                <small>{step.label}</small>
                {step.image ? (
                  <img src={src(step.image)} alt={step.label} loading="lazy" />
                ) : (
                  <p>“{step.text}”</p>
                )}
              </div>
            </li>
          ))}
        </ol>
        {c.skipped && <p className={styles.muted}>재료가 부족해 이번 맞히기는 건너뛰었어요.</p>}
        {game.stage === "voting" && c.author !== self && (
          <button
            className={game.myVote === c.id ? styles.button : styles.secondary}
            disabled={busy || !!game.myVote}
            onClick={() => void act({ action: "drawing-vote", chainId: c.id })}
          >
            <ThumbsUp size={15} />
            {game.myVote === c.id ? "내가 고른 이야기" : "이 이야기에 한 표"}
          </button>
        )}
        {(game.stage === "voting" || finished) && game.settings.mode === "relay" && (
          <small className={styles.storyVotes}>{game.voteCounts[c.id] ?? 0}표</small>
        )}
      </article>
    );
  }

  return (
    <section className={styles.stage} aria-label="낙서톡 게임">
      {toast && (
        <div key={toast.id} className={styles.dgToast} role="status">
          {toast.text}
        </div>
      )}

      <header className={styles.dgTop}>
        <span className={styles.dgMode}>
          {mode.emoji} {mode.title}
        </span>
        {progressLabel && <span className={styles.dgRound}>{progressLabel}</span>}
        {submitPhase && game.expected > 0 && (
          <span className={styles.dgRound} aria-label="제출 현황">
            ✋ {Math.min(game.submittedCount, game.expected)}/{game.expected}명 완료
          </span>
        )}
        <CreativeClock
          endsAt={game.endsAt}
          serverNow={game.serverNow}
          paused={game.paused}
          onExpired={onRefresh}
        />
      </header>

      {!finished && current >= 0 && (
        <ol className={styles.dgSteps} aria-label="진행 단계">
          {mode.steps.map((step, index) => (
            <li
              key={step.title}
              data-state={index < current ? "done" : index === current ? "now" : "next"}
              aria-current={index === current ? "step" : undefined}
            >
              <span>{index < current ? "✓" : index + 1}</span>
              <small>{step.title}</small>
            </li>
          ))}
        </ol>
      )}

      <div
        className={styles.dgTask}
        data-tone={task.tone}
        data-prompt={drawingNow && !game.submitted && !game.paused}
      >
        <span className={styles.dgTaskEmoji} aria-hidden="true">
          {task.emoji}
        </span>
        {drawingNow && !game.submitted && !game.paused && game.assignment ? (
          <div>
            <small>
              {game.stage === "live" ? "정답 · 모두가 맞히게 그려요" : "이 문장을 그려요"}
            </small>
            <strong>{game.assignment.prompt}</strong>
            <p>{task.detail}</p>
          </div>
        ) : (
          <div>
            <small>
              {task.tone === "act" ? "내 할 일" : task.tone === "wait" ? "기다리는 중" : "지금은"}
            </small>
            <strong>{task.title}</strong>
            <p>{task.detail}</p>
          </div>
        )}
      </div>

      {game.submitted && submitPhase && (
        <div className={styles.dgWait} role="status">
          <Hourglass size={22} />
          <div>
            <span>잘 넘겼어요! 모두 마치면 자동으로 다음 단계로 넘어가요.</span>
            <progress
              aria-label="제출 현황"
              value={Math.min(game.submittedCount, game.expected)}
              max={game.expected}
            />
          </div>
        </div>
      )}

      {writing && !game.submitted && game.assignment && (
        <form
          method="post"
          aria-label="낙서톡 문장 전달"
          className={styles.dgWrite}
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void act({ action: "drawing-text", text: text.trim() });
          }}
        >
          {game.stage === "interpret" &&
            (game.assignment.image ? (
              <div className={styles.dgPicture}>
                <img src={src(game.assignment.image)} alt="내게 온 그림" />
              </div>
            ) : (
              <p className={styles.empty}>
                앞 사람이 그림을 남기지 못했어요. 떠오르는 짧은 문장을 적어도 좋아요.
              </p>
            ))}
          <label className={styles.dgField}>
            <span>{game.stage === "prompt" ? "내 문장" : "이 그림은…"}</span>
            <input
              name="text"
              pattern={".*\\S.*"}
              enterKeyHint="send"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={100}
              required
              autoComplete="off"
              placeholder={
                game.stage === "prompt" ? "예: 떡볶이를 먹는 펭귄" : "예: 치킨을 들고 있는 오리"
              }
            />
          </label>
          <div className={styles.dgFieldMeta}>
            {game.stage === "prompt" ? (
              <button
                type="button"
                className={styles.dgIdea}
                onClick={() =>
                  setText(
                    PROMPT_IDEAS.filter((idea) => idea !== text)[
                      Math.floor(Math.random() * (PROMPT_IDEAS.length - 1))
                    ]!,
                  )
                }
              >
                <Dices size={15} /> 아이디어 받기
              </button>
            ) : (
              <span />
            )}
            <small>{text.length}/100</small>
          </div>
          <button className={styles.button} disabled={busy || game.paused || !text.trim()}>
            <Send size={16} /> 문장 넘기기
          </button>
        </form>
      )}

      {drawingNow && !game.submitted && game.assignment && (
        <>
          <GameCanvas
            key={game.assignment.canvasId}
            ref={canvas}
            roomId={room.id}
            host={room.isHost}
            phaseId={game.phaseId}
            canvasId={game.assignment.canvasId}
            editable={!game.paused}
          />
          {game.stage === "draw" && (
            <div className={styles.dgDock}>
              <button
                className={styles.button}
                disabled={busy || saving || game.paused}
                onClick={() => void submitImage()}
              >
                {saving ? "그림을 넘기고 있어요…" : "그림 완성! 다음 사람에게 넘기기"}
              </button>
            </div>
          )}
        </>
      )}

      {watchingLive && (
        <>
          <p className={styles.dgCanvasLabel}>
            <span aria-hidden="true">🖍️</span> {artist}의 그림
            {game.stage === "live" && <em>실시간</em>}
          </p>
          <GameCanvas
            roomId={room.id}
            host={room.isHost}
            phaseId={game.phaseId}
            canvasId={game.liveCanvasId!}
            editable={false}
          />
        </>
      )}

      {game.canGuess && (
        <>
          {game.guesses.length > 0 && (
            <ul className={styles.dgGuesses} aria-label="내가 낸 답">
              {game.guesses.map((g) => (
                <li key={g.id} data-accepted={g.accepted}>
                  {g.accepted ? "✅" : "⏳"} {g.text}
                  <small>{g.accepted ? "정답 인정!" : "확인 중"}</small>
                </li>
              ))}
            </ul>
          )}
          <form
            method="post"
            aria-label="그림 정답 제출"
            className={`${styles.dgDock} ${styles.dgGuessBar}`}
            onSubmit={async (e) => {
              e.preventDefault();
              if (text.trim() && (await act({ action: "drawing-guess", text: text.trim() })))
                setText("");
            }}
          >
            <label className={styles.hiddenLabel} htmlFor={`${uid}-answer`}>
              그림 정답
            </label>
            <input
              id={`${uid}-answer`}
              name="guess"
              pattern={".*\\S.*"}
              enterKeyHint="send"
              required
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={100}
              placeholder="정답은?"
              autoComplete="off"
            />
            <button className={styles.button} disabled={busy || game.paused || !text.trim()}>
              맞히기
            </button>
          </form>
        </>
      )}

      {game.canJudge && (
        <section className={styles.dgJudge} aria-label="들어온 답 확인">
          <header>
            <strong>들어온 답</strong>
            <small>같은 뜻이면 인정해요 · 가장 먼저 들어온 정답 한 명이 2점</small>
          </header>
          {game.guesses.length ? (
            <ul>
              {[...game.guesses]
                .sort((a, b) => a.receivedAt - b.receivedAt)
                .map((g) => (
                  <li key={g.id} data-accepted={g.accepted}>
                    <div>
                      <strong>{g.text}</strong>
                      <small>{name(g.playerId)}</small>
                    </div>
                    <button
                      className={g.accepted ? styles.button : styles.secondary}
                      disabled={busy || g.accepted || game.paused}
                      onClick={() => void act({ action: "drawing-judge", guessId: g.id })}
                    >
                      {g.accepted ? "✅ 인정됨" : "정답 인정"}
                    </button>
                  </li>
                ))}
            </ul>
          ) : (
            <p className={styles.muted}>아직 들어온 답이 없어요. 곧 올라올 거예요!</p>
          )}
        </section>
      )}

      {game.revealed.length > 0 && (
        <div className={styles.storyList}>{game.revealed.map(storyCard)}</div>
      )}

      {finished &&
        (scored ? (
          <CreativeWinners players={game.roster} />
        ) : (
          <div className={styles.finish}>
            <h3>우리의 그림이 이야기가 됐어요</h3>
            <p className={styles.muted}>완성된 이야기를 함께 감상해요.</p>
          </div>
        ))}
      {scored && (finished || ["live", "judging", "review"].includes(game.stage)) && (
        <CreativeScores players={game.roster} self={self} />
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
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
