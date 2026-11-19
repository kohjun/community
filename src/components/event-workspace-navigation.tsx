import Link from "next/link";
import { Megaphone, Users } from "lucide-react";

export function EventWorkspaceNavigation({
  postId,
  active,
  hasRoom = true,
}: {
  postId: string;
  active: "dashboard" | "room";
  hasRoom?: boolean;
}) {
  return (
    <nav className="event-workspace-nav" aria-label="행사 운영 메뉴">
      <Link
        href={`/management/events/${postId}`}
        aria-current={active === "dashboard" ? "page" : undefined}
      >
        <Users size={18} aria-hidden="true" />
        참가 현황 · 승인
      </Link>
      {hasRoom ? (
        <Link href={`/rooms/${postId}`} aria-current={active === "room" ? "page" : undefined}>
          <Megaphone size={18} aria-hidden="true" />
          공지방
        </Link>
      ) : (
        <span aria-disabled="true">
          <Megaphone size={18} aria-hidden="true" />
          공지방 미설정
        </span>
      )}
    </nav>
  );
}
