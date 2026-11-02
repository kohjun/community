"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, BookOpen, Clapperboard, Compass, Clock3, Users } from "lucide-react";
import type { LibraryPage } from "@/domain/library";
import { appRequest } from "@/lib/api-client";
const guides = [
  {
    title: "게임의 시작은 좋은 룰북에서",
    description: "규칙·준비물·진행자 멘트를 한 번에 살펴보세요.",
    href: "/archive?kind=rulebook",
    label: "룰북 찾아보기",
    icon: BookOpen,
  },
  {
    title: "다음 모임은 템플릿으로",
    description: "이벤트 템플릿에서 기획과 진행 순서를 찾아보세요.",
    href: "/archive?kind=template",
    label: "템플릿 찾아보기",
    icon: Clapperboard,
  },
  {
    title: "첫 호스트라면 여기부터",
    description: "지역과 취향을 정하고 작은 모임부터 준비해보세요.",
    href: "/hosting-guide",
    label: "첫 진행 가이드",
    icon: Compass,
  },
];
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
  return (
    <section className="home-archive" aria-labelledby="home-archive-title">
      <div className="section-heading">
        <h2 id="home-archive-title">
          <BookOpen size={20} className="blue" />
          다음 모임을 만드는 아카이브
        </h2>
        <Link className="text-button" href="/archive">
          전체 보기
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <p>룰북과 이벤트 템플릿으로, 해보고 싶었던 콘텐츠를 직접 열어보세요.</p>
      <div className="home-archive-grid">
        {items.length
          ? items.map((item) => (
              <Link className="home-archive-card" key={item.id} href={"/archive/" + item.id}>
                <span className="home-archive-icon">
                  {item.kind === "rulebook" ? <BookOpen size={27} /> : <Clapperboard size={27} />}
                </span>
                <small>{item.kind === "rulebook" ? "룰북" : "이벤트 템플릿"}</small>
                <h3>{item.title}</h3>
                <p>{item.summary}</p>
                <div className="home-archive-meta">
                  <span>
                    <Users size={13} />
                    {item.minPlayers}~{item.maxPlayers}명
                  </span>
                  <span>
                    <Clock3 size={13} />
                    {item.durationMinutes}분
                  </span>
                </div>
                <strong>
                  {item.priceKRW ? item.priceKRW.toLocaleString() + "원" : "무료"}
                  <ArrowUpRight size={16} />
                </strong>
              </Link>
            ))
          : guides.map(({ title, description, href, label, icon: Icon }) => (
              <Link className="home-archive-card" key={href} href={href}>
                <span className="home-archive-icon">
                  <Icon size={27} />
                </span>
                <h3>{title}</h3>
                <p>{description}</p>
                <strong>
                  {label}
                  <ArrowUpRight size={16} />
                </strong>
              </Link>
            ))}
      </div>
    </section>
  );
}
