import Link from "next/link";
import { TOPIC_STARTERS } from "@/domain/community-maturity";
import { topicCreationUrl, type CuratedTopic } from "@/domain/topics";
export function TopicStarter({ topic }: { topic: CuratedTopic }) {
  const starter = TOPIC_STARTERS[topic.slug];
  return (
    <details className="maturity-panel">
      <summary>
        이 주제가 처음이라면 <small>입문 안내·함께 생각할 질문</small>
      </summary>
      <p>{starter.intro}</p>
      <p>{starter.preparation}</p>
      <h3>함께 이야기해볼 질문</h3>
      <p>{starter.question}</p>
      <div className="maturity-actions">
        <Link href={topicCreationUrl(topic.slug, "stories")}>이 주제로 이야기 쓰기</Link>
        <Link href={`/stories?category=${topic.category}&discussionType=question&focus=unanswered`}>
          답변을 기다리는 질문
        </Link>
        <Link href={`/archive?category=${topic.category}&difficulty=easy`}>
          준비 난이도 쉬운 자료
        </Link>
      </div>
      <p className="form-note">
        작성자가 입력한 준비 난이도예요. 활동 인원과 규칙도 함께 확인해주세요.
      </p>
      <p>{starter.improvement}</p>
      <Link href="/hosting-guide">한 지역에서 4주 동안 함께 운영하기 →</Link>
    </details>
  );
}
