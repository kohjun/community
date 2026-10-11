import Link from "next/link";
import { ArrowUpRight, Compass } from "lucide-react";
import { ParticipationShell } from "@/components/participation-shell";
import { TOPICS, topicAliases } from "@/domain/topics";
export default function Page() {
  return (
    <ParticipationShell>
      <section className="marketplace-hero topics-hero">
        <div>
          <span className="marketplace-kicker">SLIPER TOPICS</span>
          <h1>어떤 즐거움을 찾고 있나요?</h1>
          <p>취향 하나로 이야기부터 모임, 진행 자료까지 이어서 둘러보세요.</p>
        </div>
        <Compass size={32} aria-hidden="true" />
      </section>
      <div className="topics-catalog">
        {TOPICS.map((topic, index) => (
          <Link className="topics-catalog-card" href={"/topics/" + topic.slug} key={topic.slug}>
            <span className="topics-catalog-number">
              0{index + 1}
              <ArrowUpRight size={18} aria-hidden="true" />
            </span>
            <h2>{topic.title}</h2>
            <p>{topic.description}</p>
            <div className="topics-tags">
              {topicAliases(topic)
                .slice(0, 3)
                .map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
            </div>
          </Link>
        ))}
      </div>
      <aside className="topics-guide">
        <strong>함께 쌓아가는 주제</strong>
        <p>
          글과 자료를 올릴 때 관련 태그를 붙이면 같은 취향의 페이지에 연결돼요. 이야기를 나누고,
          만나서 놀고, 좋은 진행 방법을 남겨보세요.
        </p>
        <Link href="/stories">이야기 둘러보기 →</Link>
      </aside>
    </ParticipationShell>
  );
}
