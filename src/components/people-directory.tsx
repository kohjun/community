import Link from "next/link";
import type { ReactNode } from "react";
import { Handshake, UserRound } from "lucide-react";
import { ParticipationShell } from "./participation-shell";

export function PeopleDirectory({
  tab,
  children,
}: {
  tab: "players" | "crews";
  children: ReactNode;
}) {
  return (
    <ParticipationShell>
      <header className="people-directory-header">
        <span className="player-eyebrow">함께할 사람을 만나는 곳</span>
        <h1>플레이어·크루</h1>
        <p>취향이 맞는 플레이어를 만나고, 다음 이벤트를 함께 만들 팀을 찾아보세요.</p>
      </header>
      <nav className="people-directory-tabs" aria-label="플레이어·크루 탐색">
        <Link href="/players" aria-current={tab === "players" ? "page" : undefined}>
          <UserRound size={18} />
          플레이어 찾기
        </Link>
        <Link href="/players?tab=crews" aria-current={tab === "crews" ? "page" : undefined}>
          <Handshake size={18} />
          크루 찾기
        </Link>
      </nav>
      <div className="people-directory-body">{children}</div>
    </ParticipationShell>
  );
}
