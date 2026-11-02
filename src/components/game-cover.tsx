import { GlassWater, Gamepad2, Gavel, MessageCircle, ScanFace, Sparkles } from "lucide-react";
import type { CatalogGameId } from "@/domain/game-catalog";
import styles from "./game-catalog.module.css";
export function GameCover({ game, large = false }: { game: CatalogGameId; large?: boolean }) {
  const Icon =
    game === "toast"
      ? GlassWater
      : game === "auction"
        ? Gavel
        : game === "word-liar"
          ? ScanFace
          : game === "lobby"
            ? Gamepad2
            : MessageCircle;
  return (
    <div
      className={`${styles.cover} ${large ? styles.largeCover : ""}`}
      data-game={game}
      aria-hidden="true"
    >
      <span className={styles.coverGrid} />
      <span className={styles.orbit} />
      <span className={styles.coverBadge}>
        <Sparkles size={12} /> SLIPER ORIGINAL
      </span>
      <span className={styles.tileBack}>
        {game === "toast"
          ? "건배?"
          : game === "mbti-intro"
            ? "ISTJ"
            : game === "auction"
              ? "VALUE ?"
              : game === "word-liar"
                ? "진짜?"
                : "LET’S"}
      </span>
      <span className={styles.iconTile}>
        <Icon strokeWidth={1.65} />
      </span>
      <span className={styles.tileFront}>
        {game === "toast"
          ? "몇 명?"
          : game === "mbti-intro"
            ? "ENFP"
            : game === "auction"
              ? "140 G"
              : game === "word-liar"
                ? "의심 +1"
                : "PLAY"}
      </span>
      <span className={styles.coverDot} />
    </div>
  );
}
