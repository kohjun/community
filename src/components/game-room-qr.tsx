"use client";
import { useEffect, useRef, useState } from "react";
import { Trigger as DialogTrigger } from "@radix-ui/react-dialog";
import { Copy, Download, Maximize2, Minimize2, QrCode, RefreshCw } from "lucide-react";
import { gameJoinUrl } from "@/domain/game-invite";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import styles from "./game-room-qr.module.css";
export function GameRoomQr({
  roomId,
  title,
  isHost,
  players,
  capacity,
  waitingCount,
}: {
  roomId: string;
  title: string;
  isHost: boolean;
  players: number;
  capacity: number;
  waitingCount: number;
}) {
  const [code, setCode] = useState<{ url: string; image: string } | null>(null),
    [error, setError] = useState("");
  const [open, setOpen] = useState(false),
    [retry, setRetry] = useState(0),
    [notice, setNotice] = useState("");
  const [supportsFullscreen, setSupportsFullscreen] = useState(false),
    [fullscreen, setFullscreen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    setCode(null);
    setError("");
    async function generate() {
      try {
        const url = gameJoinUrl(window.location.origin, roomId);
        const QRCode = (await import("qrcode")).default;
        const image = await QRCode.toDataURL(url, {
          width: 1024,
          margin: 4,
          errorCorrectionLevel: "M",
          color: { dark: "#121826", light: "#ffffff" },
        });
        if (alive) setCode({ url, image });
      } catch {
        if (alive) setError("QR 코드를 준비하지 못했어요. 다시 만들어주세요.");
      }
    }
    void generate();
    return () => {
      alive = false;
    };
  }, [roomId, retry]);
  useEffect(() => {
    setSupportsFullscreen(document.fullscreenEnabled === true);
    const changed = () =>
      setFullscreen(document.fullscreenElement === panel.current && panel.current !== null);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  function changeOpen(value: boolean) {
    if (!value && panel.current && document.fullscreenElement === panel.current)
      void document.exitFullscreen().catch(() => {});
    setNotice("");
    setOpen(value);
  }
  async function toggleFullscreen() {
    try {
      if (panel.current && document.fullscreenElement === panel.current)
        await document.exitFullscreen();
      else await panel.current?.requestFullscreen();
    } catch {
      setNotice("이 브라우저에서는 크게 보기 화면을 그대로 이용해주세요.");
    }
  }
  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.url);
      setNotice("참가 링크를 복사했어요.");
    } catch {
      setNotice("아래 참가 링크를 선택해 복사해주세요.");
    }
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <div className={styles.invitation}>
        {isHost && (
          <div className={styles.preview}>
            <span className={styles.eyebrow}>
              <QrCode size={15} /> QR로 함께 모여요
            </span>
            {code ? (
              <img src={code.image} width={180} height={180} alt="게임 참가 QR 코드" />
            ) : (
              <div className={styles.placeholder} role="status">
                {error ? "QR 준비가 필요해요" : "QR 코드를 만들고 있어요…"}
              </div>
            )}
            <p>
              휴대폰 카메라로 스캔하면
              <br />
              로그인 없이 바로 참가할 수 있어요.
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
            <button type="button" onClick={() => setRetry((v) => v + 1)}>
              <RefreshCw size={14} /> 다시 만들기
            </button>
          </p>
        )}
        <div className={styles.actions}>
          <DialogTrigger asChild>
            <button type="button" className={styles.button} disabled={!code}>
              <Maximize2 size={16} />
              {isHost ? "QR 크게 보기" : "QR로 초대하기"}
            </button>
          </DialogTrigger>
          {code && (
            <a className={styles.button} href={code.image} download={`sliper-game-${roomId}.png`}>
              <Download size={16} />
              QR 저장
            </a>
          )}
        </div>
      </div>
      <DialogContent ref={panel} className={styles.presentation}>
        <header className={styles.heading}>
          <span className={styles.eyebrow}>
            <QrCode size={16} /> SLIPER PLAY
          </span>
          <DialogTitle className={styles.title}>{title}</DialogTitle>
          <DialogDescription className={styles.description}>
            휴대폰 카메라로 QR 코드를 비추고 게임방에 참가하세요.
          </DialogDescription>
        </header>
        {code && (
          <img
            className={styles.largeCode}
            src={code.image}
            width={600}
            height={600}
            alt="게임 참가 QR 코드 크게 보기"
          />
        )}
        <div className={styles.counts} aria-label="참가 인원 현황" aria-live="polite">
          <span>
            입장{" "}
            <strong>
              {players} / {capacity}명
            </strong>
          </span>
          <span>
            대기 <strong>{waitingCount}명</strong>
          </span>
        </div>
        <div className={styles.presentationActions}>
          {supportsFullscreen && (
            <button type="button" className={styles.button} onClick={() => void toggleFullscreen()}>
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              {fullscreen ? "전체 화면 나가기" : "전체 화면으로 보기"}
            </button>
          )}
          <button type="button" className={styles.button} onClick={() => void copy()}>
            <Copy size={16} />
            참가 링크 복사
          </button>
          {code && (
            <a className={styles.button} href={code.image} download={`sliper-game-${roomId}.png`}>
              <Download size={16} />
              QR 저장
            </a>
          )}
        </div>
        <p role="status" className={styles.notice}>
          {notice}
        </p>
        <label className={styles.url}>
          참가 링크
          <input
            readOnly
            aria-label="QR 참가 링크"
            value={code?.url ?? ""}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
      </DialogContent>
    </Dialog>
  );
}
