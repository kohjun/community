"use client";
import Link from "next/link";
import { Check, Plus, ArrowUpRight } from "lucide-react";
import { TOPICS, topicUrl, topicsForTags } from "@/domain/topics";

export function RelatedTopics({ tags }: { tags: readonly string[] }) {
  const connected = topicsForTags(tags);
  if (!connected.length) return null;
  return (
    <nav className="topic-connection-related" aria-label="관련 주제">
      <span className="topic-connection-label">관련 주제</span>
      <div className="topic-connection-links">
        {connected.map((topic) => (
          <Link
            key={topic.slug}
            href={topicUrl(topic.slug)}
            className="topic-connection-topic-link"
          >
            {topic.title}
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function TopicTagPicker({
  tags,
  onAddTag,
  disabled = false,
  maxTags = 5,
}: {
  tags: readonly string[];
  onAddTag: (tag: string) => void;
  disabled?: boolean;
  maxTags?: number;
}) {
  const connected = topicsForTags(tags);
  const selected = new Set(connected.map((topic) => topic.slug));
  const full = tags.filter((tag) => tag.trim()).length >= maxTags;
  return (
    <section className="topic-connection-picker" aria-label="주제 연결">
      <div className="topic-connection-picker-heading">
        <span className="topic-connection-label">
          주제 연결 <small>선택</small>
        </span>
        <span className="topic-connection-limit">
          {tags.filter((tag) => tag.trim()).length}/{maxTags}개 태그
        </span>
      </div>
      <p className="topic-connection-description">
        주제를 선택하면 연결에 필요한 태그가 추가돼요. 직접 입력한 태그는 그대로 유지돼요.
      </p>
      <div className="topic-connection-choices">
        {TOPICS.map((topic) => {
          const checked = selected.has(topic.slug);
          return (
            <button
              key={topic.slug}
              type="button"
              className="topic-connection-choice"
              aria-pressed={checked}
              disabled={disabled || full || checked}
              onClick={() => onAddTag(topic.aliases[0])}
            >
              {checked ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Plus size={14} aria-hidden="true" />
              )}
              {topic.title}
              {checked && <span className="topic-connection-selected-label">연결됨</span>}
            </button>
          );
        })}
      </div>
      <p className="topic-connection-preview" aria-live="polite">
        {connected.length
          ? "연결될 주제: " + connected.map((topic) => topic.title).join(" · ")
          : "현재 태그에 연결된 주제가 없어요. 필요한 주제만 선택해주세요."}
      </p>
      {full && (
        <p className="topic-connection-description">
          태그는 최대 {maxTags}개까지 사용할 수 있어요. 새 주제를 연결하려면 태그를 하나 지워주세요.
        </p>
      )}
    </section>
  );
}
