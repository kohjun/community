"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, CalendarDays, Heart, MapPin, MessageCircle } from "lucide-react";
import { ParticipationShell } from "./participation-shell";
import {
  TOPICS,
  topicAliases,
  topicUrl,
  type TopicDetail,
  type TopicSection,
  type TopicPostSummary,
} from "@/domain/topics";
import { DISCUSSION_LABELS } from "@/domain/discussions";

const sections = [
  { id: "stories", key: "storiesPage", label: "이야기", icon: MessageCircle },
  { id: "recruitment", key: "recruitmentPage", label: "모임", icon: CalendarDays },
  { id: "library", key: "libraryPage", label: "진행 자료", icon: BookOpen },
] as const;
type SectionId = (typeof sections)[number]["id"];
const date = (value: string) =>
  new Date(value).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
  });
function Pagination({
  data,
  section,
  page,
}: {
  data: TopicDetail;
  section: (typeof sections)[number];
  page: TopicSection<unknown>;
}) {
  if (page.pageCount < 2) return null;
  const start = Math.max(1, Math.min(page.page - 2, page.pageCount - 4));
  const pages = Array.from({ length: Math.min(5, page.pageCount) }, (_, index) => start + index);
  const href = (value: number) =>
    topicUrl(data.topic.slug, { ...data.query, [section.key]: value }) + "#" + section.id;
  return (
    <nav className="topics-pagination" aria-label={section.label + " 페이지"}>
      {page.page > 1 && <Link href={href(page.page - 1)}>이전</Link>}
      {pages.map((number) => (
        <Link
          key={number}
          href={href(number)}
          aria-current={number === page.page ? "page" : undefined}
        >
          {number}
        </Link>
      ))}
      {page.page < page.pageCount && <Link href={href(page.page + 1)}>다음</Link>}
      <span>
        {page.page} / {page.pageCount}
      </span>
    </nav>
  );
}
function PostRow({ post }: { post: TopicPostSummary }) {
  return (
    <Link href={post.href} className="topics-post-row">
      <div className="topics-row-heading">
        <span className="topics-type">
          {post.kind === "모집"
            ? post.eventAvailable
              ? "모집 중"
              : "모집 종료"
            : post.discussionType
              ? DISCUSSION_LABELS[post.discussionType]
              : post.kind}
        </span>
        {post.spoiler && <span className="topics-spoiler">스포일러 주의</span>}
        <h3>{post.title}</h3>
      </div>
      <p className="topics-excerpt">{post.excerpt}</p>
      <div className="topics-meta">
        <span>{post.author}</span>
        <span>{date(post.createdAt)}</span>
        {post.location && (
          <span>
            <MapPin size={13} />
            {post.location}
          </span>
        )}
        {post.eventStartsAt && (
          <span>
            <CalendarDays size={13} />
            {date(post.eventStartsAt)}
          </span>
        )}
        {post.eventAmountKRW !== null && (
          <span>
            {post.eventAmountKRW ? post.eventAmountKRW.toLocaleString("ko-KR") + "원" : "무료"}
          </span>
        )}
        <span>
          <Heart size={13} />
          {post.likes}
        </span>
        <span>
          <MessageCircle size={13} />
          {post.comments}
        </span>
      </div>
    </Link>
  );
}
export function TopicDetailView({
  data,
  invalidQuery,
}: {
  data: TopicDetail;
  invalidQuery: boolean;
}) {
  const [active, setActive] = useState<SectionId>("stories");
  useEffect(() => {
    const restore = () => {
      const hash = window.location.hash.slice(1);
      if (sections.some((section) => section.id === hash)) setActive(hash as SectionId);
    };
    restore();
    window.addEventListener("hashchange", restore);
    return () => window.removeEventListener("hashchange", restore);
  }, [data.query.storiesPage, data.query.recruitmentPage, data.query.libraryPage]);
  function select(value: SectionId) {
    setActive(value);
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search + "#" + value,
    );
  }
  const current = sections.find((section) => section.id === active)!;
  return (
    <ParticipationShell>
      <Link className="topics-back" href="/topics">
        <ArrowLeft size={15} />
        주제 탐색
      </Link>
      <section className="marketplace-hero topics-hero">
        <div>
          <span className="marketplace-kicker">취향으로 이어지는 즐거움</span>
          <h1>{data.topic.title}</h1>
          <p>{data.topic.description}</p>
        </div>
      </section>
      <nav className="topics-topic-nav" aria-label="탐색 주제">
        {TOPICS.map((topic) => (
          <Link
            key={topic.slug}
            href={topicUrl(topic.slug, { focus: data.query.focus })}
            aria-current={topic.slug === data.topic.slug ? "page" : undefined}
          >
            {topic.title}
          </Link>
        ))}
      </nav>
      <div className="topics-focus">
        <nav aria-label="관심 피드">
          <Link
            href={topicUrl(data.topic.slug)}
            aria-current={data.query.focus === "all" ? "page" : undefined}
          >
            전체 보기
          </Link>
          <Link
            href={topicUrl(data.topic.slug, { focus: "interests" })}
            aria-current={data.query.focus === "interests" ? "page" : undefined}
          >
            <Heart size={14} />내 관심 글
          </Link>
        </nav>
        <Link href="/notifications">관심사 설정 →</Link>
      </div>
      {invalidQuery && (
        <p className="topics-guide" role="status">
          검색 조건을 확인할 수 없어 첫 페이지를 보여드려요.
        </p>
      )}
      {data.interestFeed === "login" && (
        <p className="topics-guide">
          로그인하면 구독한 분야와 호스트의 글을 모아볼 수 있어요. 지금은 이 주제의 전체 글을
          보여드려요.{" "}
          <Link
            href={
              "/login?returnTo=" +
              encodeURIComponent(topicUrl(data.topic.slug, { focus: "interests" }))
            }
          >
            로그인
          </Link>
        </p>
      )}
      {data.interestFeed === "setup" && (
        <p className="topics-guide">
          관심사나 호스트를 구독하면 나에게 맞는 글이 보여요. 지금은 이 주제의 전체 글을 보여드려요.{" "}
          <Link href="/notifications">관심사 선택</Link>
        </p>
      )}
      {data.interestFeed === "personalized" && (
        <p className="topics-feed-note">
          이야기와 모임은 구독한 관심사·호스트 기준으로, 진행 자료는 이 주제의 전체 자료를
          보여드려요.
        </p>
      )}
      <div className="topics-section-tabs" role="tablist" aria-label="주제별 콘텐츠">
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={active === id}
            aria-controls={"topic-panel-" + id}
            id={"topic-tab-" + id}
            tabIndex={active === id ? 0 : -1}
            onKeyDown={(event) => {
              const index = sections.findIndex((section) => section.id === id);
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % sections.length
                  : event.key === "ArrowLeft"
                    ? (index + sections.length - 1) % sections.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? sections.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              const section = sections[next]!;
              select(section.id);
              document.getElementById("topic-tab-" + section.id)?.focus();
            }}
            onClick={() => select(id)}
          >
            <Icon size={16} />
            {label}
            <span>{data[id].total.toLocaleString("ko-KR")}</span>
          </button>
        ))}
      </div>
      {sections.map((section) => (
        <section
          role="tabpanel"
          tabIndex={0}
          key={section.id}
          id={"topic-panel-" + section.id}
          aria-labelledby={"topic-tab-" + section.id}
          hidden={active !== section.id}
          className="topics-panel"
        >
          <div className="topics-section-title">
            <h2>{section.label}</h2>
            <span>최신순 · {data[section.id].total.toLocaleString("ko-KR")}개</span>
          </div>
          {section.id === "library" ? (
            <div className="topics-library-list">
              {data.library.items.map((entry) => (
                <Link key={entry.id} href={entry.href} className="topics-library-card">
                  <div className="topics-row-heading">
                    <span className="topics-type">
                      {entry.kind === "template" ? "이벤트 템플릿" : "룰북"}
                    </span>
                    <span className="topics-price">
                      {entry.priceKRW ? entry.priceKRW.toLocaleString("ko-KR") + "원" : "무료 자료"}
                    </span>
                  </div>
                  <h3>{entry.title}</h3>
                  <p>{entry.summary}</p>
                  <small>
                    {entry.author} · {date(entry.createdAt)}
                  </small>
                </Link>
              ))}
            </div>
          ) : (
            data[section.id].items.map((post) => <PostRow key={post.id} post={post} />)
          )}
          {!data[section.id].total && (
            <div className="topics-empty">
              <strong>
                아직 연결된{" "}
                {section.label === "모임"
                  ? "모임이"
                  : section.label === "진행 자료"
                    ? "자료가"
                    : "이야기가"}{" "}
                없어요
              </strong>
              <p>같은 취향을 가진 사람에게 첫 콘텐츠를 소개해보세요.</p>
              <Link
                href={
                  section.id === "library"
                    ? "/archive/new"
                    : "/stories?category=" + data.topic.category
                }
              >
                {section.id === "library" ? "자료 올리기" : "이야기와 모집글 올리기"} →
              </Link>
            </div>
          )}
          {data[section.id].limited && (
            <p className="topics-feed-note">
              최근 {data[section.id].pageSize * data[section.id].pageCount}개까지 볼 수 있어요.
            </p>
          )}
          <Pagination data={data} section={section} page={data[section.id]} />
        </section>
      ))}
      <aside className="topics-guide">
        <strong>이 주제에 글과 자료를 연결하려면</strong>
        <p>
          작성할 때 아래 태그 중 하나를 붙여주세요. 여러 태그를 붙여도 같은 콘텐츠는 한 번만 보여요.
        </p>
        <div className="topics-tags">
          {topicAliases(data.topic).map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
        <p>
          스포일러가 표시된 글은 태그로 연결하지 않아요. 유료 자료와 참가자 전용 기록은 원래의 열람
          권한을 따라요.
        </p>
      </aside>
      <span className="sr-only">현재 선택: {current.label}</span>
    </ParticipationShell>
  );
}
