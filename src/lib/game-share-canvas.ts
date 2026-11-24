"use client";
import QRCode from "qrcode";
import type { GameShareSummary } from "@/domain/game-share-card";

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1920;

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  const pushCharByChar = (token: string) => {
    for (const ch of token) {
      const candidate = current + ch;
      if (ctx.measureText(candidate).width > maxWidth && current) {
        lines.push(current);
        current = ch;
        if (lines.length >= maxLines) return;
      } else {
        current = candidate;
      }
    }
  };

  for (const word of words) {
    if (lines.length >= maxLines) break;
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else if (!current) {
      pushCharByChar(word);
    } else {
      lines.push(current);
      current = "";
      if (lines.length < maxLines) {
        if (ctx.measureText(word).width <= maxWidth) current = word;
        else pushCharByChar(word);
      }
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1] ?? "";
    while (last.length > 1 && ctx.measureText(last).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = last;
  }
  return lines;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function rankColors(rank: number): { bg: string; fg: string } {
  if (rank === 1) return { bg: "#F59E0B", fg: "#111827" };
  if (rank === 2) return { bg: "#CBD5E1", fg: "#0F172A" };
  if (rank === 3) return { bg: "#D97706", fg: "#FFFFFF" };
  return { bg: "rgba(255,255,255,0.16)", fg: "#FFFFFF" };
}

export interface RenderedShareCard {
  blob: Blob;
  dataUrl: string;
  filename: string;
}

/**
 * Renders a crisp 1080×1920 (9:16 Instagram Story / mobile share) PNG poster containing
 * game winners, top-5 scoreboard, viewer highlight, and a scannable QR code back to Sliper.
 */
export async function renderGameShareCardPng(
  summary: GameShareSummary,
): Promise<RenderedShareCard> {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("결과 카드를 생성할 수 없는 브라우저 환경이에요.");

  const fontStack =
    '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  const { theme } = summary;

  // 1. Vibrant multi-stop background gradient
  const bg = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  bg.addColorStop(0, theme.bgStart);
  bg.addColorStop(0.52, theme.bgMid);
  bg.addColorStop(1, theme.bgEnd);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Ambient glow orbs
  const orb1 = ctx.createRadialGradient(880, 260, 40, 880, 260, 460);
  orb1.addColorStop(0, `${theme.accent}55`);
  orb1.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = orb1;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const orb2 = ctx.createRadialGradient(180, 1460, 30, 180, 1460, 440);
  orb2.addColorStop(0, "rgba(255,255,255,0.18)");
  orb2.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = orb2;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Subtle decorative grid dots
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  for (let gx = 90; gx < CARD_WIDTH; gx += 110) {
    for (let gy = 110; gy < 620; gy += 110) {
      ctx.beginPath();
      ctx.arc(gx, gy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 2. Top brand bar
  roundedRectPath(ctx, 76, 86, 420, 66, 33);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#FFFFFF";
  ctx.font = `800 30px ${fontStack}`;
  ctx.textBaseline = "middle";
  ctx.fillText("sliper.", 112, 119);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = `700 22px ${fontStack}`;
  ctx.fillText(`·  ${theme.badge}`, 220, 120);

  const today = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
  }).format(new Date());
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.76)";
  ctx.font = `600 26px ${fontStack}`;
  ctx.fillText(today, CARD_WIDTH - 76, 119);
  ctx.textAlign = "left";

  // 3. Hero Game Title + Winner Headline
  ctx.font = `700 108px ${fontStack}`;
  ctx.fillText(theme.emoji, 76, 286);

  ctx.fillStyle = theme.accent;
  ctx.font = `800 32px ${fontStack}`;
  ctx.fillText(summary.gameName.toUpperCase(), 218, 252);

  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = `600 30px ${fontStack}`;
  ctx.fillText(summary.roomTitle.slice(0, 26), 218, 304);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = `900 72px ${fontStack}`;
  const headlineLines = wrapLines(ctx, summary.headline, CARD_WIDTH - 152, 2);
  let yCursor = 428;
  for (const line of headlineLines) {
    ctx.fillText(line, 76, yCursor);
    yCursor += 90;
  }

  ctx.fillStyle = "rgba(255,255,255,0.84)";
  ctx.font = `600 32px ${fontStack}`;
  ctx.fillText(summary.subline.slice(0, 40), 76, yCursor + 12);
  yCursor += 74;

  // Optional viewer highlight pill
  if (summary.myHighlight) {
    const rankText = summary.myHighlight.rank ? `${summary.myHighlight.rank}위 · ` : "";
    const chipText = `내 기록  ${summary.myHighlight.nickname}  (${rankText}${summary.myHighlight.metric})`;
    ctx.font = `700 28px ${fontStack}`;
    const chipWidth = Math.min(CARD_WIDTH - 152, ctx.measureText(chipText).width + 64);
    roundedRectPath(ctx, 76, yCursor, chipWidth, 64, 32);
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fill();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(chipText, 108, yCursor + 32);
    yCursor += 94;
  }

  // 4. Glassmorphism Podium Card
  const boardTop = Math.max(yCursor + 16, 680);
  const rows = summary.podium.slice(0, 5);
  const rowHeight = 108;
  const boardHeight = Math.max(240, 112 + rows.length * rowHeight);
  roundedRectPath(ctx, 76, boardTop, CARD_WIDTH - 152, boardHeight, 36);
  ctx.fillStyle = "rgba(15, 23, 42, 0.44)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `700 26px ${fontStack}`;
  ctx.fillText("TODAY'S SCOREBOARD", 118, boardTop + 56);

  ctx.textAlign = "right";
  ctx.fillText(`${summary.playerCount}명 참여`, CARD_WIDTH - 118, boardTop + 56);
  ctx.textAlign = "left";

  rows.forEach((row, index) => {
    const rowY = boardTop + 98 + index * rowHeight;
    roundedRectPath(ctx, 108, rowY, CARD_WIDTH - 216, 88, 22);
    ctx.fillStyle = row.isViewer
      ? "rgba(56, 189, 248, 0.24)"
      : index === 0
        ? "rgba(251, 191, 36, 0.2)"
        : "rgba(255, 255, 255, 0.08)";
    ctx.fill();
    if (row.isViewer || index === 0) {
      ctx.strokeStyle = row.isViewer ? theme.accent : "rgba(251, 191, 36, 0.6)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const badge = rankColors(row.rank);
    roundedRectPath(ctx, 130, rowY + 18, 72, 52, 16);
    ctx.fillStyle = badge.bg;
    ctx.fill();
    ctx.fillStyle = badge.fg;
    ctx.font = `800 26px ${fontStack}`;
    ctx.textAlign = "center";
    ctx.fillText(`${row.rank}위`, 166, rowY + 45);
    ctx.textAlign = "left";

    const label = row.isViewer ? `${row.nickname} (나)` : row.nickname;
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `700 34px ${fontStack}`;
    ctx.fillText(label.slice(0, 15), 226, rowY + 45);

    ctx.textAlign = "right";
    ctx.fillStyle = index === 0 ? "#FDE047" : "#E2E8F0";
    ctx.font = `800 32px ${fontStack}`;
    ctx.fillText(row.metric, CARD_WIDTH - 134, rowY + 45);
    ctx.textAlign = "left";
  });

  // 5. Viral QR Invite Footer Box
  const footerHeight = 320;
  const footerTop = CARD_HEIGHT - footerHeight - 86;
  roundedRectPath(ctx, 76, footerTop, CARD_WIDTH - 152, footerHeight, 36);
  ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
  ctx.fill();

  const qrDataUrl = await QRCode.toDataURL(summary.shareUrl, {
    width: 240,
    margin: 1,
    color: { dark: "#0F172A", light: "#FFFFFF" },
  });
  const qrImage = await loadImage(qrDataUrl);
  ctx.drawImage(qrImage, 114, footerTop + 40, 240, 240);

  const textX = 388;
  ctx.fillStyle = "#0A84FE";
  ctx.font = `800 26px ${fontStack}`;
  ctx.fillText("설치 없이 QR로 10초 만에 시작", textX, footerTop + 86);

  ctx.fillStyle = "#0F172A";
  ctx.font = `900 44px ${fontStack}`;
  const ctaLines = wrapLines(ctx, summary.funTag, CARD_WIDTH - textX - 110, 2);
  let ctaY = footerTop + 148;
  for (const line of ctaLines) {
    ctx.fillText(line, textX, ctaY);
    ctaY += 54;
  }

  ctx.fillStyle = "#64748B";
  ctx.font = `700 26px ${fontStack}`;
  const displayHost = summary.shareUrl.replace(/^https?:\/\//, "");
  ctx.fillText(displayHost.slice(0, 34), textX, footerTop + 266);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("이미지 생성에 실패했어요."))),
      "image/png",
      0.95,
    );
  });

  return {
    blob,
    dataUrl: canvas.toDataURL("image/png"),
    filename: `sliper-${summary.gameId}-result.png`,
  };
}
