"use client";
import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import type { CommunityPost } from "@/domain/community";
import { CATEGORIES } from "@/domain/categories";
import { postPath } from "@/domain/post-sharing";
import { shouldOpenPostModal } from "@/lib/post-sharing";

const scenes = [
  { name: "race", label: "미션 레이스", alt: "한강 공원에서 바통을 넘기며 달리는 참가자들" },
  { name: "mystery", label: "추리 게임", alt: "테이블에 둘러앉아 단서 카드를 맞춰보는 사람들" },
  { name: "party", label: "취향 파티", alt: "루프탑에서 카드를 들고 웃으며 대화하는 사람들" },
] as const;

function Scene({ name, label, alt, eager }: (typeof scenes)[number] & { eager?: boolean }) {
  return (
    <figure className={"sl-hero__scene sl-hero__scene--" + name}>
      <img
        src={`/images/home/${name}-1200.webp`}
        srcSet={`/images/home/${name}-640.webp 640w, /images/home/${name}-1200.webp 1200w`}
        sizes="(max-width: 720px) 45vw, 560px"
        alt={alt}
        width={1200}
        height={750}
        loading={eager ? "eager" : "lazy"}
        {...(eager ? { fetchPriority: "high" as const } : {})}
      />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function HomeHero({
  recruitCount,
  nextEvent,
  onBrowse,
  onHost,
  onOpen,
}: {
  recruitCount: number;
  nextEvent: CommunityPost | undefined;
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
        <div className="sl-hero__scenes">
          {scenes.map((scene, index) => (
            <Scene key={scene.name} {...scene} eager={index === 0} />
          ))}
        </div>
        {nextEvent && (
          <a
            className="sl-hero__next"
            href={postPath(nextEvent.id)}
            onClick={(event) => {
              if (!shouldOpenPostModal(event)) return;
              event.preventDefault();
              onOpen(nextEvent);
            }}
          >
            <span className="sl-hero__next-label">
              {nextEvent.sample ? "모임 예시" : "곧 열리는 모임"} ·{" "}
              {CATEGORIES.find((c) => c.slug === nextEvent.category)?.name}
            </span>
            <strong>{nextEvent.title}</strong>
            <span className="sl-hero__next-meta">
              {nextEvent.eventDate && (
                <span>
                  <CalendarDays size={13} aria-hidden="true" />
                  {nextEvent.eventDate}
                </span>
              )}
              {nextEvent.location && (
                <span>
                  <MapPin size={13} aria-hidden="true" />
                  {nextEvent.location}
                </span>
              )}
            </span>
          </a>
        )}
      </div>
    </section>
  );
}
