import Link from "next/link";
import { ArrowUpRight, Trees, UsersRound } from "lucide-react";
import styles from "./town.module.css";
export function TownEntry() {
  return (
    <Link href="/games/town" className={styles.entry}>
      <span className={styles.entryArt} aria-hidden="true">
        <Trees size={40} />
        <span>sliper town</span>
      </span>
      <span className={styles.entryCopy}>
        <small>새로운 만남의 공간 · 베타</small>
        <strong>잠깐, 광장에서 만날까요?</strong>
        <span>아바타로 산책하고, 이야기하다가 함께 게임해요.</span>
        <em>
          <UsersRound size={14} /> 회원 전용 · 시험 정원 8명
        </em>
      </span>
      <ArrowUpRight size={23} />
    </Link>
  );
}
