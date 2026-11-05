"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Clapperboard, Compass } from "lucide-react";
import type { LibraryPage } from "@/domain/library";
import { appRequest } from "@/lib/api-client";
const guides = [
  {
    title: "게임의 시작은 좋은 룰북에서",
    description: "규칙·준비물·진행자 멘트",
    href: "/archive?kind=rulebook",
    kind: "룰북",
    icon: BookOpen,
  },
  {
    title: "다음 모임은 템플릿으로",
    description: "기획과 진행 순서",
    href: "/archive?kind=template",
    kind: "이벤트 템플릿",
    icon: Clapperboard,
  },
  {
    title: "첫 호스트라면 여기부터",
    description: "작은 모임부터 준비하기",
    href: "/hosting-guide",
    kind: "가이드",
    icon: Compass,
  },
];

/** Planning resources for hosts: real archive items when available, starter guides otherwise. */
export function HomeArchive() {
  const [items, setItems] = useState<LibraryPage["items"]>([]);
  useEffect(() => {
    const c = new AbortController();
    void appRequest<LibraryPage>("/api/library", "GET", undefined, c.signal)
      .then((v) => {
        if (!c.signal.aborted) setItems(v.items.slice(0, 3));
      })
      .catch(() => {});
    return () => c.abort();
  }, []);
  const rows = items.length
    ? items.map((item) => ({
        key: item.id,
        href: "/archive/" + item.id,
        kind: item.kind === "rulebook" ? "룰북" : "이벤트 템플릿",
        title: item.title,
        description: `${item.minPlayers}~${item.maxPlayers}명 · ${item.durationMinutes}분 · ${
          item.priceKRW ? item.priceKRW.toLocaleString() + "원" : "무료"
        }`,
        icon: item.kind === "rulebook" ? BookOpen : Clapperboard,
      }))
    : guides.map((guide) => ({ ...guide, key: guide.href }));
  return (
    <section className="sl-module sl-archive" aria-labelledby="home-archive-title">
      <header className="sl-module__head">
        <div>
          <h2 id="home-archive-title">모임 준비 자료</h2>
          <p>룰북과 이벤트 템플릿으로 기획 시간을 줄여보세요.</p>
        </div>
        <Link className="sl-text-link" href="/archive">
          아카이브
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </header>
      <ul className="sl-archive__list">
        {rows.map(({ key, href, kind, title, description, icon: Icon }) => (
          <li key={key}>
            <Link href={href}>
              <span className="sl-archive__icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <span className="sl-archive__copy">
                <small>{kind}</small>
                <strong>{title}</strong>
                <span>{description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
