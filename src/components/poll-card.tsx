"use client";
import { Vote, Check } from "lucide-react";
import type { CommunityPoll } from "@/domain/community";
export function PollCard({
  poll,
  canVote,
  busy,
  onVote,
}: {
  poll: CommunityPoll;
  canVote: boolean;
  busy: boolean;
  onVote: (index: number) => void;
}) {
  return (
    <section className="poll-card" aria-label="의견 투표">
      <div className="poll-heading">
        <Vote size={20} />
        <span>함께 정하는 다음 에피소드</span>
        <b>{poll.total}명 참여</b>
      </div>
      <h3>{poll.question}</h3>
      <div className="poll-results">
        {poll.options.map((option, index) => {
          const percent = poll.total ? Math.round((option.votes / poll.total) * 100) : 0;
          return (
            <button
              key={index}
              disabled={!canVote || busy}
              aria-pressed={poll.selected === index}
              className={poll.selected === index ? "selected" : ""}
              onClick={() => onVote(index)}
            >
              <span className="poll-fill" style={{ width: `${percent}%` }} />
              <span className="poll-label">
                {poll.selected === index && <Check size={16} />} {option.label}
              </span>
              <span className="poll-count">
                {option.votes}표 · {percent}%
              </span>
            </button>
          );
        })}
      </div>
      <p>
        {canVote
          ? poll.selected === null
            ? "한 가지를 선택하고, 댓글로 이유도 나눠주세요."
            : "참여했어요! 다른 항목을 누르면 선택을 바꿀 수 있어요."
          : "투표는 로그인 후 참여할 수 있어요."}
      </p>
    </section>
  );
}
