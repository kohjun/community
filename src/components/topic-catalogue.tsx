import Link from "next/link";
import { ArrowUpRight, Brain, Route, Sparkles } from "lucide-react";
import { TOPICS, topicAliases } from "@/domain/topics";
import styles from "./workspace-navigation.module.css";
const icons = { mystery: Brain, "mission-race": Route, "social-party": Sparkles };
export function TopicCatalogue() {
  return (
    <section id="topics" className={styles.topicSection} aria-labelledby="search-topics-title">
      <header className={styles.topicHeading}>
        <h2 id="search-topics-title">주제별로 둘러보기</h2>
        <p>마음에 드는 주제를 고르면 이야기·모집·진행 자료를 함께 볼 수 있어요.</p>
      </header>
      <div className={styles.topicGrid}>
        {TOPICS.map((topic) => {
          const Icon = icons[topic.slug];
          return (
            <Link className={styles.topicCard} href={"/topics/" + topic.slug} key={topic.slug}>
              <div className={styles.topicCardTop}>
                <Icon size={23} aria-hidden="true" />
                <ArrowUpRight size={17} aria-hidden="true" />
              </div>
              <h3>{topic.title}</h3>
              <p>{topic.description}</p>
              <div className={styles.topicTags}>
                {topicAliases(topic)
                  .slice(0, 3)
                  .map((tag) => (
                    <span key={tag}>#{tag}</span>
                  ))}
              </div>
            </Link>
          );
        })}
      </div>
      <p className={styles.topicGuide}>
        글과 자료에 관련 태그를 붙이면 같은 취향의 주제 페이지에도 연결돼요.
      </p>
    </section>
  );
}
