"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { CommunityPost } from "@/domain/community";
import { HeroCarousel } from "./hero-carousel";

export function HomeHero({
  recruitCount,
  recruitments,
  onBrowse,
  onHost,
  onOpen,
}: {
  recruitCount: number;
  recruitments: CommunityPost[];
  onBrowse: () => void;
  onHost: () => void;
  onOpen: (post: CommunityPost) => void;
}) {
  return (
    <section className="sl-hero" aria-labelledby="sl-hero-title">
      <div className="sl-hero__copy">
        <p className="sl-hero__eyebrow">
          {recruitCount > 0 ? (
            <>
              <span className="sl-live-dot" aria-hidden="true" />
              지금 참가 신청 받는 모임 {recruitCount}개
            </>
          ) : (
            "취향으로 모이는 오프라인 모임 커뮤니티"
          )}
        </p>
        <h1 id="sl-hero-title">
          예능처럼 노는 오프라인 모임,
          <br />
          <em>슬리퍼에 다 모여 있어요.</em>
        </h1>
        <p className="sl-hero__lead">
          미션 레이스, 추리 게임, 취향 파티까지. 여러 호스트와 플랫폼이 여는 모임을 한곳에서
          둘러보고, 마음에 들면 바로 신청하세요.
        </p>
        <div className="sl-audience" role="group" aria-label="이용 방법 선택">
          <button type="button" className="sl-audience__card is-primary" onClick={onBrowse}>
            <span className="sl-audience__who">참여하고 싶다면</span>
            <strong>
              모임 둘러보기
              <ArrowRight size={18} aria-hidden="true" />
            </strong>
            <span className="sl-audience__what">신청·공지·입장까지 한 번에</span>
          </button>
          <button type="button" className="sl-audience__card" onClick={onHost}>
            <span className="sl-audience__who">호스트·기업이라면</span>
            <strong>
              우리 모임 홍보하기
              <ArrowRight size={18} aria-hidden="true" />
            </strong>
            <span className="sl-audience__what">모집글 하나로 신청 관리까지</span>
          </button>
        </div>
        <Link className="sl-hero__guide" href="/hosting-guide">
          처음 모임을 열어본다면, 호스트 가이드부터 읽어보세요
        </Link>
      </div>
      <div className="sl-hero__visual">
        <HeroCarousel posts={recruitments} onOpen={onOpen} />
      </div>
    </section>
  );
}
