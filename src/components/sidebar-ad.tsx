import Link from "next/link";
import { ArrowUpRight, Clapperboard, Sparkles, Zap } from "lucide-react";

export function SidebarAd({ placement = "left" }: { placement?: "left" | "right" }) {
  const right = placement === "right";
  return (
    <aside
      className={"sidebar-ad-rail sidebar-ad-rail--" + placement}
      aria-label={right ? "오른쪽 광고" : "왼쪽 광고"}
      data-ad-slot={"site-" + placement}
    >
      <div className="sidebar-ad-sticky">
        <span className="sidebar-ad-label">광고 · 미리보기</span>
        <Link
          href={right ? "/lightning" : "/archive"}
          className="sidebar-ad-banner"
          aria-label={
            right
              ? "슬리퍼 번개 모임 둘러보기 · 광고 미리보기"
              : "슬리퍼 아카이브 둘러보기 · 광고 미리보기"
          }
        >
          <div className="sidebar-ad-brand">
            <img src="/images/sliper-logo.png" alt="" width={32} height={32} />
            <span>sliper.</span>
          </div>
          <div className="sidebar-ad-copy">
            <span>{right ? "가까이에서 시작되는 즐거움" : "주말의 다음 에피소드"}</span>
            <h2>
              {right ? "오늘은 가볍게," : "보는 예능을,"}
              <br />
              <em>{right ? "슬쩍 만나볼까요?" : "하는 예능으로."}</em>
            </h2>
            <p>
              {right ? "우리 동네 사람들과" : "취향 맞는 사람들과"}
              <br />
              {right ? "부담 없는 번개로" : "새로운 주말을"}
              <br />
              {right ? "일상을 즐겨보세요." : "만들어보세요."}
            </p>
          </div>
          <div className="sidebar-ad-art" aria-hidden="true">
            <span className="sidebar-ad-orbit" />
            <span className="sidebar-ad-icon">
              {right ? (
                <Zap size={46} strokeWidth={1.5} />
              ) : (
                <Clapperboard size={46} strokeWidth={1.5} />
              )}
            </span>
            <Sparkles className="sidebar-ad-spark" size={22} strokeWidth={1.5} />
          </div>
          <div className="sidebar-ad-tags" aria-hidden="true">
            {right ? (
              <>
                <span>동네</span>
                <span>취향</span>
                <span>번개</span>
              </>
            ) : (
              <>
                <span>추리</span>
                <span>레이스</span>
                <span>파티</span>
              </>
            )}
          </div>
          <span className="sidebar-ad-action">
            {right ? "번개 모임 둘러보기" : "모임 만들어보기"} <ArrowUpRight size={14} />
          </span>
        </Link>
      </div>
    </aside>
  );
}
