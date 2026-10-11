"use client";
import Link from "next/link";
import { useState } from "react";
import { HeartHandshake } from "lucide-react";
import { type MannerReviewView } from "@/domain/player";
import { appRequest, RequestError } from "@/lib/api-client";
import { ParticipationShell } from "./participation-shell";
export function PlayerMannerReview({ initial }: { initial: MannerReviewView }) {
  const [data, setData] = useState<MannerReviewView | null>(initial),
    [target, setTarget] = useState(""),
    [sentiment, setSentiment] = useState<"positive" | "negative">("positive"),
    [tag, setTag] = useState("배려"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      setData(
        await appRequest<MannerReviewView>(`/api/players/events/${initial.postId}/manner`, "POST", {
          targetPublicId: target,
          sentiment,
          tags: [sentiment === "negative" ? "진행 방해" : tag],
        }),
      );
      setTarget("");
    } catch (e) {
      if (
        e instanceof RequestError &&
        ["FORBIDDEN", "UNAUTHENTICATED", "NOT_FOUND"].includes(e.code ?? "")
      ) {
        setData(null);
        setTarget("");
      }
      setError(e instanceof Error ? e.message : "평가를 저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ParticipationShell>
      <section className="player-hero">
        <div>
          <span className="player-eyebrow">함께한 게임, 함께한 사람</span>
          <h1>함께한 플레이어에게</h1>
          <p>{initial.title}</p>
        </div>
        <HeartHandshake size={38} />
      </section>
      <section className="participation-card">
        <h2>매너 평가</h2>
        <p className="player-note">
          실제 참가가 확인된 플레이어끼리 한 행사에서 한 번씩 평가할 수 있어요. 공개 프로필에는
          합계만 표시되고 평가자와 개별 내용은 공개하지 않습니다.
        </p>
        {error && (
          <p role="alert" className="participation-error">
            {error}
          </p>
        )}
        <div className="player-record-list">
          {data?.members.map((m) => (
            <div key={m.publicId}>
              <Link href={`/players/${m.publicId}`}>{m.nickname}</Link>
              <button
                className="participation-secondary"
                disabled={busy || m.reviewed}
                onClick={() => {
                  setTarget(m.publicId);
                  setSentiment("positive");
                  setTag("배려");
                }}
              >
                {m.reviewed ? "평가 완료" : "평가 남기기"}
              </button>
            </div>
          ))}
        </div>
        {data && !data.members.length && (
          <p className="player-note">함께한 플레이어의 참가 기록이 아직 없어요.</p>
        )}
        {target && data && (
          <form
            className="player-result-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <h3>{data.members.find((m) => m.publicId === target)?.nickname}님과의 경험</h3>
            <label>
              평가
              <select
                value={sentiment}
                onChange={(e) => setSentiment(e.target.value as "positive" | "negative")}
              >
                <option value="positive">즐겁게 함께했어요</option>
                <option value="negative">게임 진행이 불편했어요</option>
              </select>
            </label>
            {sentiment === "positive" ? (
              <label>
                어떤 모습이 좋았나요?
                <select value={tag} onChange={(e) => setTag(e.target.value)}>
                  <option value="배려">다른 플레이어를 배려했어요</option>
                  <option value="규칙 준수">게임 규칙을 잘 지켰어요</option>
                </select>
              </label>
            ) : (
              <p className="player-note">
                진행 방해 경험을 기록합니다. 게임 실력이나 승패를 이유로 평가하지 말아주세요.
              </p>
            )}
            <div className="player-actions">
              <button className="participation-primary" disabled={busy}>
                평가 등록
              </button>
              <button
                className="participation-secondary"
                type="button"
                onClick={() => setTarget("")}
              >
                닫기
              </button>
            </div>
          </form>
        )}
      </section>
      <Link className="participation-secondary" href="/players">
        플레이어 탐색
      </Link>
    </ParticipationShell>
  );
}
