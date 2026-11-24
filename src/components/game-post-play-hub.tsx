"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  BellRing,
  Bookmark,
  Check,
  Copy,
  Download,
  Gamepad2,
  QrCode,
  Share2,
  Sparkles,
  Zap,
} from "lucide-react";
import type { GameRoomView } from "@/domain/game-room";
import { extractGameShareSummary, isGameResultReady } from "@/domain/game-share-card";
import { renderGameShareCardPng } from "@/lib/game-share-canvas";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { useSession } from "./session-provider";
import styles from "./game-post-play-hub.module.css";

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Post-game viral loop + guest-to-member conversion bridge shown automatically once any
 * Sliper web game reaches its result scoreboard.
 */
export function GamePostPlayHub({ room }: { room: GameRoomView }) {
  const { session, ready } = useSession();
  const [busyAction, setBusyAction] = useState<"share" | "download" | "preview" | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "https://sliper.kr";
  const resultReady = isGameResultReady(room);
  const summary = useMemo(
    () => (resultReady ? extractGameShareSummary(room, origin) : null),
    [resultReady, room, origin],
  );

  if (!resultReady || !summary) return null;

  async function ensureRendered() {
    if (previewUrl && previewBlob) {
      return {
        blob: previewBlob,
        dataUrl: previewUrl,
        filename: `sliper-${summary!.gameId}-result.png`,
      };
    }
    const rendered = await renderGameShareCardPng(summary!);
    setPreviewUrl(rendered.dataUrl);
    setPreviewBlob(rendered.blob);
    return rendered;
  }

  async function handleDownload() {
    if (busyAction) return;
    setBusyAction("download");
    setError("");
    setStatus("");
    try {
      const rendered = await ensureRendered();
      triggerDownload(rendered.blob, rendered.filename);
      setStatus("인스타 스토리용 9:16 결과 카드를 저장했어요!");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "결과 카드를 만들지 못했어요.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleShare() {
    if (busyAction) return;
    setBusyAction("share");
    setError("");
    setStatus("");
    try {
      const rendered = await ensureRendered();
      const file = new File([rendered.blob], rendered.filename, { type: "image/png" });
      const nav = navigator as Navigator & {
        canShare?: (data: { files?: File[] }) => boolean;
      };
      if (typeof nav.share === "function" && (!nav.canShare || nav.canShare({ files: [file] }))) {
        await nav.share({
          files: [file],
          title: `${summary!.gameName} 결과 — Sliper`,
          text: `${summary!.headline} · QR 찍고 설치 없이 바로 한 판!`,
          url: summary!.shareUrl,
        });
        setStatus("결과 카드를 공유했어요!");
      } else {
        triggerDownload(rendered.blob, rendered.filename);
        setStatus("9:16 결과 카드를 저장했어요. 인스타 스토리나 단톡방에 바로 올려보세요!");
      }
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") {
        setStatus("");
      } else {
        setError("공유 시트를 열지 못했어요. ‘9:16 이미지 저장’ 버튼을 이용해주세요.");
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handlePreview() {
    if (busyAction) return;
    setBusyAction("preview");
    setError("");
    try {
      await ensureRendered();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "미리보기를 만들지 못했어요.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCopyLink() {
    setError("");
    try {
      await navigator.clipboard.writeText(summary!.shareUrl);
      setCopied(true);
      setStatus("게임 초대 링크를 복사했어요! 단톡방이나 스토리에 붙여넣어 보세요.");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("링크를 자동으로 복사하지 못했어요.");
    }
  }

  const loginUrl = `/login?returnTo=${encodeURIComponent(summary.guestReturnPath)}&from=game-result`;
  const isGuest = ready && !session?.authenticated;
  const personalBridgeHeadline = summary.myHighlight?.rank
    ? `방금 ${summary.myHighlight.nickname}님으로 ${summary.myHighlight.rank}위 하셨네요!`
    : summary.myHighlight?.nickname
      ? `${summary.myHighlight.nickname}님, 방금 한 판 재미있으셨나요?`
      : "방금 함께한 웹게임, 재미있으셨나요?";

  return (
    <section className={styles.hub} aria-label="게임 결과 공유와 다음 즐길 거리">
      {/* 1. Automatic 9:16 Instagram Story Viral Share Card */}
      <div className={styles.shareCard}>
        <div className={styles.shareCopy}>
          <span className={styles.eyebrow}>
            <Sparkles size={13} aria-hidden="true" />
            9:16 인스타 스토리 · 단톡방 결과 카드
          </span>
          <h3>방금 한 판 결과를 카드로 바로 공유해보세요</h3>
          <p>
            오늘의 순위와 <strong>{summary.gameName}</strong> QR 코드가 자동으로 담긴 9:16 세로
            포스터를 1초 만에 만들어드려요. 스토리나 모임 단톡방에 올리면 친구들이 QR로 바로 따라 할
            수 있어요.
          </p>
          <div className={styles.shareActions}>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={busyAction !== null}
              onClick={() => void handleShare()}
            >
              <Share2 size={15} aria-hidden="true" />
              {busyAction === "share" ? "카드 만드는 중…" : "스토리·친구에게 공유"}
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={busyAction !== null}
              onClick={() => void handleDownload()}
            >
              <Download size={15} aria-hidden="true" />
              {busyAction === "download" ? "저장 중…" : "9:16 이미지 저장"}
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => void handleCopyLink()}
            >
              {copied ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                <Copy size={15} aria-hidden="true" />
              )}
              {copied ? "링크 복사됨" : "게임 링크 복사"}
            </button>
          </div>
          {status && (
            <p className={styles.status} role="status">
              {status}
            </p>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>

        <button
          type="button"
          className={styles.miniPosterBtn}
          style={{
            background: `linear-gradient(155deg, ${summary.theme.bgStart} 0%, ${summary.theme.bgMid} 52%, ${summary.theme.bgEnd} 100%)`,
          }}
          onClick={() => void handlePreview()}
          aria-label="9:16 공유 결과 카드 크게 미리보기"
        >
          <div className={styles.miniTop}>
            <span>sliper.</span>
            <span>9:16</span>
          </div>
          <div className={styles.miniCenter}>
            <span className={styles.miniEmoji} aria-hidden="true">
              {summary.theme.emoji}
            </span>
            <strong className={styles.miniHeadline}>{summary.headline}</strong>
            <div className={styles.miniRows}>
              {summary.podium.slice(0, 3).map((row) => (
                <div className={styles.miniRow} key={`${row.rank}-${row.nickname}`}>
                  <span>
                    {row.rank}위 {row.nickname.slice(0, 6)}
                  </span>
                  <span>{row.metric}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.miniFooter}>
            <QrCode size={12} aria-hidden="true" />
            미리보기 · 저장
          </div>
        </button>
      </div>

      {/* 2. Guest-to-Member Conversion Bridge */}
      {isGuest ? (
        <aside className={styles.bridgeCard} aria-label="슬리퍼 회원 시작 안내">
          <div className={styles.bridgeBody}>
            <span className={styles.bridgePill}>
              <Zap size={12} aria-hidden="true" />
              방금 QR로 들어오신 게스트님께
            </span>
            <h3>{personalBridgeHeadline}</h3>
            <p>
              지금 3초 만에 시작하면 나도 다음 술자리·MT에서 직접 게임방을 열고, 우리 동네 주말
              번개와 예능 모임 알림까지 받아볼 수 있어요.
            </p>
            <ul className={styles.bridgePerks}>
              <li>
                <Gamepad2 size={13} aria-hidden="true" />
                직접 QR 게임방 개설
              </li>
              <li>
                <Bookmark size={13} aria-hidden="true" />
                자주 쓰는 웹게임 찜 저장
              </li>
              <li>
                <BellRing size={13} aria-hidden="true" />
                주말 번개·모임 알림
              </li>
            </ul>
          </div>
          <div className={styles.bridgeActions}>
            <Link href={loginUrl} className={styles.bridgePrimary}>
              3초 만에 시작하기
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <Link href="/lightning" className={styles.bridgeSecondary}>
              가입 없이 주말 번개 구경하기
            </Link>
          </div>
        </aside>
      ) : (
        ready && (
          <div className={styles.memberNext}>
            <div>
              <strong>다음 모임이나 다른 웹게임도 이어서 즐겨보세요</strong>
              <p>이번 주 열리는 번개·모임과 다른 3D·추리 웹게임이 기다리고 있어요.</p>
            </div>
            <div className={styles.shareActions}>
              <Link href="/games" className={styles.secondaryBtn}>
                <Gamepad2 size={15} aria-hidden="true" />
                다른 웹게임 보기
              </Link>
              <Link href="/lightning" className={styles.primaryBtn}>
                <Zap size={15} aria-hidden="true" />
                오늘의 번개·모임
              </Link>
            </div>
          </div>
        )
      )}

      <Dialog open={previewUrl !== null} onOpenChange={(next) => !next && setPreviewUrl(null)}>
        <DialogContent className={styles.previewDialog}>
          <DialogTitle>9:16 결과 공유 카드 미리보기</DialogTitle>
          <DialogDescription>
            인스타 스토리·카카오톡 단톡방에 올리기 좋은 세로 비율(1080×1920) 이미지예요.
          </DialogDescription>
          {previewUrl && (
            <img
              src={previewUrl}
              alt={`${summary.gameName} 결과 공유 카드`}
              className={styles.previewImage}
            />
          )}
          <div className={styles.shareActions}>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={busyAction !== null}
              onClick={() => void handleShare()}
            >
              <Share2 size={15} aria-hidden="true" />
              공유하기
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={busyAction !== null}
              onClick={() => void handleDownload()}
            >
              <Download size={15} aria-hidden="true" />
              이미지 저장
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
