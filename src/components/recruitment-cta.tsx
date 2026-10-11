import Link from "next/link";
import { ArrowUpRight, CalendarDays, MapPin, Wallet } from "lucide-react";
import { Button } from "./ui/button";
import type { CommunityPost } from "@/domain/community";
export function RecruitmentApplyButton({
  postId,
  url,
  cancelledAt,
}: {
  postId: string;
  url?: string | null;
  cancelledAt?: string | null | undefined;
}) {
  return (
    <Button
      asChild
      className={cancelledAt ? "apply-button is-cancelled" : "apply-button"}
      variant={cancelledAt ? "outline" : "default"}
      size={cancelledAt ? "sm" : "default"}
    >
      {cancelledAt ? (
        <Link href={`/events/${postId}`} aria-label="취소된 행사 안내와 취소·환불 확인">
          취소 안내 보기
          <ArrowUpRight size={15} />
        </Link>
      ) : url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="외부 플랫폼에서 신청하기 (새 탭)"
        >
          신청하기
          <ArrowUpRight size={16} />
        </a>
      ) : (
        <Link href={`/events/${postId}`} aria-label="사이트에서 참가 신청하기">
          신청하기
          <ArrowUpRight size={16} />
        </Link>
      )}
    </Button>
  );
}
export function RecruitmentCta({ post }: { post: CommunityPost }) {
  const cancelled = !!post.eventCancelledAt;
  return (
    <section
      className={cancelled ? "event-brief is-cancelled" : "event-brief"}
      aria-label={cancelled ? "취소된 행사 정보" : "모집 정보"}
    >
      <div className="event-brief-top">
        <span className="event-kicker">YOUR NEXT EPISODE</span>
        <span className="event-status">{cancelled ? "주최자 행사 취소" : "함께할 사람 모집"}</span>
      </div>
      <h3>
        {cancelled ? "이 행사는 주최자가 취소했어요." : "화면 밖에서 시작하는, 우리의 에피소드."}
      </h3>
      <div className="event-facts">
        {[
          { icon: MapPin, label: "장소", value: post.location },
          { icon: CalendarDays, label: "일정 · 시간", value: post.eventDate },
          { icon: Wallet, label: "참가 비용", value: post.eventFee },
        ].map((item) => (
          <div key={item.label}>
            <item.icon size={18} />
            <span>
              <small>{item.label}</small>
              <strong>{item.value || "등록자에게 문의해주세요"}</strong>
            </span>
          </div>
        ))}
      </div>
      <p className="event-contact">
        {cancelled
          ? "신규 신청과 QR 입장이 종료되었어요. 취소 사유와 기존 참가 내역, 전액 취소·환불 안내를 확인해주세요."
          : post.applicationUrl
            ? "외부 플랫폼에서 신청·결제를 완료한 뒤 참가 승인을 받으면 전용 공지방에 참여할 수 있어요."
            : post.contactInfo || "신청하기 버튼에서 신청 정보와 전용 공지방을 확인하세요."}
      </p>
      <Link className="participation-text-link" href={`/events/${post.id}`}>
        {cancelled
          ? "취소 안내 · 내 참가·환불 확인 →"
          : post.applicationUrl
            ? "결제 후 참가 확인 · 공지방 →"
            : "참가 신청 · 공지방 →"}
      </Link>
      {post.isMine && (
        <Link
          className="participation-text-link"
          style={{ marginLeft: 16 }}
          href={`/management/events/${post.id}`}
        >
          행사 관리 →
        </Link>
      )}
    </section>
  );
}
