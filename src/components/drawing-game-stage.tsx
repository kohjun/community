"use client";
import { useEffect, useRef, useState, useId } from "react";
import type { GameRoomView } from "@/domain/game-room";
import { DRAWING_MODES, type DrawingChain } from "@/domain/creative-games";
import { uploadGameMedia } from "@/lib/game-media-client";
import { GameCanvas, type CanvasHandle } from "./game-canvas";
import {
  CreativeClock,
  CreativeSubmissionStatus,
  CreativeControls,
  CreativeScores,
  CreativeWinners,
  type CreativeAction,
} from "./creative-game-common";
import styles from "./creative-games.module.css";
import { GameRoundActions } from "./game-round-layout";
const steps = {
  lobby: "함께 준비해요",
  prompt: "시작 문장 작성",
  draw: "문장을 그림으로",
  interpret: "그림을 문장으로",
  live: "실시간 그림 맞히기",
  judging: "정답 확인",
  review: "릴레이 공개",
  gallery: "어떻게 달라졌을까요?",
  voting: "가장 재미있는 릴레이",
  result: "한 판 완료",
  aborted: "게임을 마쳤어요",
};
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
    canvas = useRef<CanvasHandle>(null),
    [text, setText] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setText("");
    setError("");
  }, [game.phaseId]);
  const src = (id: string) => `/api/games/${room.id}/media/${id}${room.isHost ? "?host=1" : ""}`;
  const act = (action: Record<string, unknown>) =>
    onAction({ ...action, runId: game.runId, phaseId: game.phaseId });
  const name = (id: string | null) => game.roster.find((p) => p.id === id)?.nickname ?? "참가자";
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
    writing = ["prompt", "interpret"].includes(game.stage),
    painting = game.stage === "draw" || game.stage === "live";
  const explanation =
    game.stage === "prompt"
      ? "다른 사람이 그림으로 표현할 시작 문장을 적어주세요."
      : game.stage === "draw"
        ? "나에게 온 문장을 그림으로 표현해주세요. 다음 사람은 그림만 보게 돼요."
        : game.stage === "interpret"
          ? "이 그림만 보고 떠오르는 장면을 한 문장으로 적어주세요."
          : game.stage === "live"
            ? game.assignment
              ? "이 문장이 정답이에요. 글자 대신 그림으로 표현해주세요."
              : game.canJudge
                ? "내가 쓴 해석 문장이 정답이에요. 비슷한 답이 오면 인정해주세요."
                : "그려지는 모습을 보고 마지막 해석 문장을 맞혀보세요."
            : game.stage === "judging"
              ? "새 답 제출을 마감했어요. 담당자가 먼저 들어온 비슷한 답을 확인하고 점수를 확정해요."
              : game.stage === "voting"
                ? "가장 재미있게 변한 다른 사람의 릴레이에 한 표를 주세요."
                : "원문부터 마지막 그림까지, 어떻게 달라졌는지 함께 감상해요.";
  function chainCard(c: DrawingChain) {
    return (
      <div key={c.id} className={styles.frame}>
        <small>{name(c.author)}의 시작 문장</small>
        <p>{c.prompt ?? "문장을 준비하지 못했어요"}</p>
        {c.image && (
          <>
            <small>{name(c.painter)}의 첫 그림</small>
            <img src={src(c.image)} alt="첫 번째 전달 그림" loading="lazy" />
          </>
        )}
        <small>{name(c.interpreter)}의 해석</small>
        <p>{c.interpretation ?? "해석을 제출하지 못했어요"}</p>
        {c.finalImage && (
          <>
            <small>{name(c.finalPainter)}의 마지막 그림</small>
            <img src={src(c.finalImage)} alt="마지막 실시간 그림" loading="lazy" />
          </>
        )}
        {c.skipped && <p className={styles.muted}>재료가 부족해 이번 맞히기는 건너뛰었어요.</p>}
        {c.winner && <p className={styles.status}>{name(c.winner)} 최초 정답!</p>}
        {game.stage === "voting" && c.author !== self && (
          <button
            className={styles.secondary}
            disabled={busy || !!game.myVote}
            onClick={() => void act({ action: "drawing-vote", chainId: c.id })}
          >
            {game.myVote === c.id ? "내가 고른 릴레이" : "이 릴레이에 한 표"}
          </button>
        )}
        {(game.stage === "voting" || finished) && <small>{game.voteCounts[c.id] ?? 0}표</small>}
      </div>
    );
  }
  return (
    <section className={styles.stage} aria-label="낙서톡 게임">
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>
            NAKSEO TALK · {DRAWING_MODES[game.settings.mode].title}
          </span>
          <h2>{steps[game.stage]}</h2>
        </div>
        <CreativeClock
          endsAt={game.endsAt}
          serverNow={game.serverNow}
          paused={game.paused}
          onExpired={onRefresh}
        />
      </div>
      <p className={styles.progress}>
        {game.set}/{game.settings.sets}바퀴 ·{" "}
        {writing || game.stage === "draw"
          ? `${game.submittedCount}/${game.expected}명 제출`
          : `${Math.min(game.index + 1, game.roster.length)}/${game.roster.length}개 ${game.settings.mode === "live" ? "그림" : "릴레이"}`}
      </p>
      {(writing || game.stage === "draw") && (
        <CreativeSubmissionStatus submitted={game.submittedCount} expected={game.expected} />
      )}
      {!finished && <p className={styles.instruction}>{explanation}</p>}
      {writing && game.assignment && !game.submitted && (
        <form
          id={`${uid}-relay`}
          method="post"
          aria-label="낙서톡 문장 전달"
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void act({ action: "drawing-text", text: text.trim() });
          }}
        >
          {game.assignment.image && (
            <div className={styles.photo}>
              <img src={src(game.assignment.image)} alt="해석할 전달 그림" />
            </div>
          )}
          {game.stage === "interpret" && !game.assignment.image && (
            <p className={styles.empty}>
              앞 사람이 그림을 남기지 못했어요. 떠오르는 짧은 문장을 적어도 좋아요.
            </p>
          )}
          <label>
            {game.stage === "prompt" ? "내 시작 문장" : "그림을 보고 떠오르는 문장"}
            <input
              name="text"
              pattern={".*\\S.*"}
              enterKeyHint="send"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={100}
              required
              placeholder={
                game.stage === "prompt" ? "예: 떡볶이를 먹는 펭귄" : "예: 치킨을 들고 있는 오리"
              }
            />
          </label>
          {game.stage === "prompt" && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() =>
                setText(
                  [
                    "떡볶이를 먹는 펭귄",
                    "노래방에서 탬버린을 흔드는 고양이",
                    "단체 사진에서 혼자 눈을 감은 토끼",
                  ][Math.floor(Math.random() * 3)]!,
                )
              }
            >
              시작 문장 추천받기
            </button>
          )}
          <GameRoundActions>
            <button
              type="submit"
              form={`${uid}-relay`}
              className={styles.button}
              disabled={busy || game.paused}
            >
              문장 전달하기
            </button>
          </GameRoundActions>
        </form>
      )}
      {game.submitted && ["prompt", "draw", "interpret"].includes(game.stage) && (
        <p className={styles.status}>전달을 마쳤어요. 다른 참가자를 기다려주세요.</p>
      )}
      {painting && game.assignment && !game.submitted && (
        <>
          <p className={styles.instruction}>
            <strong>내가 그릴 문장</strong>
            <br />
            {game.assignment.prompt}
          </p>
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
            <GameRoundActions>
              <button
                className={styles.button}
                disabled={busy || saving || game.paused}
                onClick={() => void submitImage()}
              >
                {saving ? "그림을 전달하고 있어요…" : "그림 완성 · 다음 사람에게 전달"}
              </button>
            </GameRoundActions>
          )}
        </>
      )}
      {["live", "judging"].includes(game.stage) &&
        game.liveCanvasId &&
        (!game.assignment || game.stage === "judging") && (
          <>
            <p className={styles.muted}>{name(game.artistId)}님이 그린 그림</p>
            <GameCanvas
              roomId={room.id}
              host={room.isHost}
              phaseId={game.phaseId}
              canvasId={game.liveCanvasId}
              editable={false}
            />
          </>
        )}
      {game.canGuess && (
        <GameRoundActions>
          <form
            method="post"
            aria-label="그림 정답 제출"
            className={styles.guess}
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
              placeholder="무엇을 그리고 있을까요?"
              autoComplete="off"
            />
            <button className={styles.button} disabled={busy || game.paused}>
              맞히기
            </button>
          </form>
        </GameRoundActions>
      )}
      {game.canJudge && (
        <div className={styles.judge}>
          <strong>유사 답 확인</strong>
          <p className={styles.muted}>
            같은 뜻이면 인정해주세요. 이미 들어온 답 중 가장 빠른 정답 한 명에게 2점을 줘요.
          </p>
          {game.guesses.length ? (
            game.guesses.map((g) => (
              <div className={styles.judgeRow} key={g.id}>
                <p>
                  {name(g.playerId)} · {g.text}
                </p>
                <button
                  className={styles.secondary}
                  disabled={busy || g.accepted || game.paused}
                  onClick={() => void act({ action: "drawing-judge", guessId: g.id })}
                >
                  {g.accepted ? "정답 인정됨" : "같은 뜻이에요"}
                </button>
              </div>
            ))
          ) : (
            <p className={styles.muted}>답변을 기다려요.</p>
          )}
        </div>
      )}
      {!game.canJudge && game.guesses.length > 0 && !finished && (
        <div className={styles.hint}>
          {game.guesses.map((g) => (
            <span key={g.id}>
              {g.text} · {g.accepted ? "정답 인정!" : "제출했어요"}
            </span>
          ))}
        </div>
      )}
      {game.revealed.length > 0 && (
        <div className={styles.gallery}>{game.revealed.map(chainCard)}</div>
      )}
      {finished &&
        (game.settings.scored && game.settings.mode !== "relay" ? (
          <CreativeWinners players={game.roster} />
        ) : (
          <div className={styles.finish}>
            <h3>우리의 그림이 이야기가 됐어요</h3>
            <p className={styles.muted}>완성된 릴레이를 함께 감상해요.</p>
          </div>
        ))}
      {game.settings.scored && game.settings.mode !== "relay" && (
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
