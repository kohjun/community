"use client";
import { useEffect, useState, useRef, useId } from "react";
import type { GameRoomView } from "@/domain/game-room";
import type { MapPoint } from "@/lib/naver-maps";
import { uploadGameMedia } from "@/lib/game-media-client";
import { appRequest } from "@/lib/api-client";
import { NaverEventMap } from "./naver-event-map";
import type { CreativeAction } from "./creative-game-common";
import styles from "./creative-games.module.css";
export function ClueQuestionPreparation({
  room,
  busy,
  onAction,
}: {
  room: GameRoomView;
  busy: boolean;
  onAction: CreativeAction;
}) {
  const uid = useId(),
    errorRef = useRef<HTMLParagraphElement>(null);
  const game = room.clue!,
    member = game.settings.mode === "member",
    quiz = game.settings.mode === "quiz";
  const [file, setFile] = useState<File | null>(null),
    [label, setLabel] = useState(""),
    [story, setStory] = useState(""),
    [point, setPoint] = useState<MapPoint | null>(null),
    [choices, setChoices] = useState(["", "", "", ""]),
    [correct, setCorrect] = useState(0),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState<{ id: string; status: string; src: string } | null>(null);
  useEffect(() => {
    setFile(null);
    setPoint(null);
    setLabel("");
    setStory("");
    setPending(null);
    setError("");
  }, [game.settings.mode]);
  useEffect(() => {
    if (!pending || pending.status === "ready" || pending.status === "failed") return;
    let live = true;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void appRequest<{ id: string; status: string; src: string }>(
        pending.src + (pending.src.includes("?") ? "&" : "?") + "status=1",
        "GET",
        undefined,
        controller.signal,
      )
        .then((v) => {
          if (live) setPending(v);
        })
        .catch(() => {
          if (live) setError("처리 상태를 확인하지 못했어요. 잠시 후 다시 확인해주세요.");
        });
    }, 2000);
    return () => {
      live = false;
      clearInterval(timer);
      controller.abort();
    };
  }, [pending?.id, pending?.status]);
  if (
    room.phase !== "lobby" ||
    (!member && (!room.isHost || game.settings.source !== "host")) ||
    (member && room.viewer.status !== "admitted")
  )
    return null;
  async function submit() {
    if (working || busy) return;
    if (!file || (!quiz && !point)) {
      setError(
        !file
          ? "먼저 사진 또는 소리·영상을 선택해주세요."
          : "지도에서 정답 위치를 먼저 선택해주세요.",
      );
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setWorking(true);
    setError("");
    try {
      let asset = pending;
      if (!asset) {
        asset = await uploadGameMedia(
          room.id,
          room.isHost,
          file!,
          quiz ? (file!.type.startsWith("video/") ? "video" : "audio") : "photo",
        );
        setPending(asset);
      }
      if (asset.status !== "ready") {
        setError(
          asset.status === "failed"
            ? "자료 처리에 실패했어요. 다른 파일을 선택해주세요."
            : "소리·영상을 압축하고 있어요. 준비 완료 후 문제 등록을 눌러주세요.",
        );
        return;
      }
      const ok = await onAction(
        {
          action: "clue-question",
          assetId: asset.id,
          label,
          story,
          ...(quiz ? { choices, correctChoice: correct } : { point }),
        },
        room.isHost && !member,
      );
      if (ok) {
        setFile(null);
        setPending(null);
        setLabel("");
        setStory("");
        setPoint(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "문제를 등록하지 못했어요.");
    } finally {
      setWorking(false);
    }
  }
  return (
    <section className={styles.stage} aria-label="단서각 문제 준비">
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>BEFORE WE PLAY</span>
          <h2>{member ? "내 사진 한 장으로 시작해요" : "호스트 직접 출제"}</h2>
        </div>
        <span className={styles.progress}>
          {game.preparedCount}
          {member ? `/${room.players.length}명 준비` : `/${game.settings.rounds}문제 준비`}
        </span>
      </div>
      <p className={styles.muted}>
        {member
          ? "사진과 정답 위치는 결과 공개까지 나만 볼 수 있어요. 직접 찍거나 사용할 권리가 있는 사진을 골라주세요."
          : "자료와 정답을 함께 등록해요. 직접 만든 문제에서는 채점 대상에서 제외돼요."}
      </p>
      <form
        method="post"
        aria-label="단서각 문제 등록"
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          {quiz ? "소리 30초·5MB / 영상 15초·20MB 이하" : "사진 10MB 이하"}
          <input
            type="file"
            name="media"
            required
            id={`${uid}-file`}
            accept={
              quiz
                ? "audio/*,video/mp4,video/webm,video/quicktime"
                : "image/jpeg,image/png,image/webp"
            }
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPending(null);
              setError("");
            }}
            disabled={working}
          />
        </label>
        <label>
          {quiz ? "정답 설명" : "정답 장소 이름"}
          <input
            required
            maxLength={100}
            name="answerLabel"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={quiz ? "예: 볼링공이 굴러가는 소리" : "예: 부산 광안리 해수욕장"}
          />
        </label>
        {quiz ? (
          <>
            <div className={styles.fields}>
              {choices.map((v, i) => (
                <label key={i}>
                  보기 {i + 1}
                  <input
                    required
                    value={v}
                    maxLength={100}
                    onChange={(e) =>
                      setChoices((a) => a.map((old, n) => (n === i ? e.target.value : old)))
                    }
                  />
                </label>
              ))}
            </div>
            <label>
              정답 보기
              <select value={correct} onChange={(e) => setCorrect(Number(e.target.value))}>
                {choices.map((v, i) => (
                  <option value={i} key={i}>
                    보기 {i + 1} · {v || "내용을 적어주세요"}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <p className={styles.muted}>
              지도에서 사진 속 정답 지점을 눌러주세요. 현재 내 위치를 수집하지 않아요.
            </p>
            <div className={styles.map}>
              <NaverEventMap
                clientId={process.env.NEXT_PUBLIC_NAVER_MAP_KEY_ID ?? null}
                pins={
                  point
                    ? [{ ...point, id: "answer", kind: "place", label: "내가 등록할 정답 지점" }]
                    : []
                }
                selectedId={point ? "answer" : null}
                onSelect={() => {}}
                onBoundsChange={() => {}}
                picking={!working}
                onPick={setPoint}
                focusPoint={{ latitude: 36.5, longitude: 127.8, zoom: 7 }}
              />
            </div>
            <p className={styles.progress}>
              {point ? "정답 지점을 선택했어요" : "지도에서 정답 위치를 선택해주세요"}
            </p>
          </>
        )}
        <label>
          공개 후 나눌 이야기
          <textarea
            value={story}
            onChange={(e) => setStory(e.target.value)}
            maxLength={300}
            placeholder="이 장소나 단서에 얽힌 이야기를 적어주세요."
          />
        </label>
        {pending && (
          <p className={styles.status}>
            {pending.status === "ready"
              ? "자료 준비 완료 · 아래에서 문제를 등록해주세요"
              : pending.status === "failed"
                ? "자료 처리 실패 · 다른 파일을 선택해주세요"
                : "소리·영상을 압축하고 있어요…"}
          </p>
        )}
        <button
          className={styles.button}
          disabled={busy || working || !!(pending && pending.status !== "ready")}
        >
          {working ? "자료를 올리고 있어요…" : member ? "내 사진·정답 등록" : "문제 등록"}
        </button>
      </form>
      {game.myPrepared.map((q) => (
        <div key={q.id} className={styles.prepared}>
          <span>{q.label}</span>
          <strong>등록 완료</strong>
        </div>
      ))}
      {error && (
        <p ref={errorRef} tabIndex={-1} id={`${uid}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
