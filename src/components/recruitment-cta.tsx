import Link from "next/link";
import { naverPlaceLink } from "@/lib/naver-maps";
import { ArrowUpRight, CalendarDays, MapPin, UsersRound, Wallet } from "lucide-react";
import { Button } from "./ui/button";
import type { CommunityPost } from "@/domain/community";
import { januaryRecruitmentSample } from "@/demo/january-recruitments";
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
  const sample = januaryRecruitmentSample(post);
  const lightning = post.meetupType === "lightning" && !post.applicationUrl;
  const facts = [
    { icon: MapPin, label: "장소", value: post.location },
    { icon: CalendarDays, label: "일정 · 시간", value: post.eventDate },
    ...(post.eventCapacity
      ? [{ icon: UsersRound, label: "모집 정원", value: `${post.eventCapacity}명` }]
      : []),
    {
      icon: Wallet,
      label: "참가 비용",
      value: lightning && !sample ? "사전 결제 없이 현장 정산" : post.eventFee,
    },
  ];
  return (
    <section
      className={cancelled ? "event-brief is-cancelled" : "event-brief"}
      aria-label={cancelled ? "취소된 행사 정보" : "모집 정보"}
    >
      <div className="event-brief-top">
        <span className="event-kicker">참가 안내</span>
        <span className="event-status">
          {sample ? "1월 모집 샘플" : cancelled ? "주최자 행사 취소" : "함께할 사람 모집"}
        </span>
      </div>
      <h3>
        {sample
          ? "모임 기본 정보"
          : cancelled
            ? "이 행사는 주최자가 취소했어요."
            : lightning
              ? "함께할 번개를 확인해주세요"
              : "모임 기본 정보"}
      </h3>
      <dl className="event-facts">
        {facts.map((item) => (
          <div key={item.label}>
            <dt>
              <item.icon size={16} aria-hidden="true" /> {item.label}
            </dt>
            <dd>{item.value || "등록자에게 문의해주세요"}</dd>
          </div>
        ))}
      </dl>
      {!sample && post.venueLatitude != null && post.venueLongitude != null && (
        <a
          className="location-map-link"
          href={naverPlaceLink(
            { latitude: post.venueLatitude, longitude: post.venueLongitude },
            post.location || post.title,
          )}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MapPin size={15} />
          네이버 지도에서 장소 보기 <ArrowUpRight size={13} />
        </a>
      )}
      <p className="event-contact">
        {sample
          ? "2027년 1월 일정을 가정한 모집글이에요. 참가 신청이나 결제는 받지 않아요."
          : cancelled
            ? "신규 신청과 QR 입장이 종료되었어요. 취소 사유와 기존 참가 내역, 전액 취소·환불 안내를 확인해주세요."
            : lightning
              ? "슬리퍼에서 참가를 신청하고 담당자가 승인하면 공지방에 입장할 수 있어요. 비용은 현장에서 함께 정산해요."
              : post.applicationUrl
                ? "외부 플랫폼에서 신청·결제를 완료한 뒤 참가 승인을 받으면 전용 공지방에 참여할 수 있어요."
                : post.contactInfo || "신청하기 버튼에서 신청 정보와 전용 공지방을 확인하세요."}
      </p>
      {sample?.type === "event" && (
        <a
          className="participation-text-link"
          href={`https://example.com/?sliper-event=${sample.exampleId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          외부 신청 링크 예시 <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      )}
      {!sample && (
        <Link className="participation-text-link" href={`/events/${post.id}`}>
          {cancelled
            ? "취소 안내 · 내 참가·환불 확인 →"
            : post.applicationUrl
              ? "결제 후 참가 확인 · 공지방 →"
              : "참가 신청 · 공지방 →"}
        </Link>
      )}
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
