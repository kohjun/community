"use client";
import { useId, useState } from "react";
import { Trigger as DialogTrigger } from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Clock3,
  Lightbulb,
  Play,
  ShieldCheck,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { getGameTutorial, type TutorialAudience, type TutorialGame } from "@/domain/game-tutorial";
import type { WordMode } from "@/domain/word-liar";
import styles from "./game-tutorial.module.css";
function PracticeExample({ game }: { game: TutorialGame }) {
  const [showCounts, setShowCounts] = useState(false),
    [votes, setVotes] = useState(3),
    [sale, setSale] = useState<number | null>(140);
  if (game === "lobby")
    return (
      <div className={styles.practiceNote}>
        실제 대기실에서 닉네임을 저장한 뒤 준비 완료를 눌러주세요. 이 설명을 닫는 것만으로 준비
        상태가 바뀌지는 않아요.
      </div>
    );
  const money = (value: number) => `${value > 0 ? "+" : ""}${value}G`;
  return (
    <details className={styles.practice}>
      <summary>
        <Play size={14} /> 예시로 이해하기 <small>실제 게임과 무관한 연습</small>
      </summary>
      <div>
        {game === "toast" ? (
          <>
            <p>
              6명 중 질문자 자신도 건배했어요. 자신을 포함해 건배한 사람은 총 3명이에요. 예상 또는
              목표 인원을 골라보세요.
            </p>
            <div className={styles.choices} role="group" aria-label="건배 인원 연습">
              {[2, 3, 4].map((count) => (
                <button
                  type="button"
                  key={count}
                  aria-pressed={votes === count}
                  onClick={() => setVotes(count)}
                >
                  {count}명
                </button>
              ))}
            </div>
            <div className={styles.feedback} role="status">
              <strong>{votes === 3 ? "3명 적중 · 질문자 +1점" : "예측 실패 · 0점"}</strong>
              <p>
                누가 건배했는지는 공개하지 않아요. 심화 모드는 예상 대신 미리 받은 목표 3명과
                비교해요.
              </p>
            </div>
          </>
        ) : game === "mbti-intro" ? (
          <>
            <p>다른 세 사람의 MBTI를 추리해 제출했다고 가정해볼게요.</p>
            <div className={styles.sampleGuesses}>
              <span>가람 · ENFP</span>
              <span>나래 · ISTJ</span>
              <span>다온 · INFJ</span>
            </div>
            <button
              type="button"
              className={styles.exampleButton}
              onClick={() => setShowCounts((v) => !v)}
            >
              {showCounts ? "예시 다시 보기" : "예시 결과 확인"}
            </button>
            {showCounts && (
              <div className={styles.feedback} role="status">
                <strong>
                  2명 O <span>· 1명 X</span>
                </strong>
                <p>
                  세 사람 중 두 명을 맞혔어요. 누가 맞고 틀렸는지는 숨긴 채 다음 라운드에서 다시
                  추리해요.
                </p>
              </div>
            )}
          </>
        ) : game === "auction" ? (
          <>
            <p>
              판매자 이번 차례 머니 <b>50G</b> · 감정가 <b>100G</b>. 매입 직후 잔액은 <b>−50G</b>
              예요.
            </p>
            <div className={styles.choices} role="group" aria-label="경매 연습 낙찰가">
              {[70, 100, 140, null].map((value) => (
                <button
                  type="button"
                  key={String(value)}
                  aria-pressed={sale === value}
                  onClick={() => setSale(value)}
                >
                  {value === null ? "유찰" : `${value}G 낙찰`}
                </button>
              ))}
            </div>
            <div className={styles.feedback} role="status">
              <strong>판매자 최종 머니 {sale === null ? 50 : sale - 50}G</strong>
              <p>
                {sale === null
                  ? "입찰이 없어 차감한 100G를 환급해요. −50G + 100G = 50G로 돌아와요."
                  : `판매자 손익 ${money(sale - 100)}, 구매자 손익 ${money(100 - sale)}. 구매한 물건의 감정가 100G는 구매자의 최종 자산에 더해요.`}
              </p>
            </div>
          </>
        ) : (
          <>
            <p>
              처음 시작한 사람이 <b>6명</b>일 때, 같은 사람에게 모인 표를 골라보세요.
            </p>
            <div className={styles.choices} role="group" aria-label="과반수 투표 연습">
              {[3, 4].map((count) => (
                <button
                  key={count}
                  type="button"
                  aria-pressed={votes === count}
                  onClick={() => setVotes(count)}
                >
                  {count}표 모임
                </button>
              ))}
            </div>
            <div className={styles.voteDots} aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} data-selected={i < votes}>
                  {i < votes ? <Check size={12} /> : null}
                </span>
              ))}
            </div>
            <div className={styles.feedback} role="status">
              <strong>{votes === 3 ? "3표는 과반수 미달" : "4표면 지목 확정"}</strong>
              <p>
                {votes === 3
                  ? "절반인 3표로는 부족해요. 아무도 확인하지 않고 다음 설명을 진행해요."
                  : "6명의 절반을 넘었어요. 지목된 사람이 라이어인지 확인하고, 라이어라면 마지막 추리로 넘어가요."}
              </p>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
export function GameTutorial({
  game,
  wordMode,
  revealLiar,
  audience = "player",
  compact = false,
  inProgress = false,
}: {
  game: TutorialGame;
  wordMode?: WordMode | undefined;
  revealLiar?: boolean | undefined;
  audience?: TutorialAudience;
  compact?: boolean;
  inProgress?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [role, setRole] = useState(audience),
    [step, setStep] = useState(0);
  const id = useId(),
    copy = getGameTutorial(game, wordMode, revealLiar);
  const steps = copy[role],
    current = steps[Math.min(step, steps.length - 1)]!;
  function changeOpen(value: boolean) {
    if (value) {
      setRole(audience);
      setStep(0);
    }
    setOpen(value);
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <div className={compact ? styles.compact : styles.preview}>
        <span className={styles.book}>
          <BookOpen size={compact ? 17 : 21} />
        </span>
        <div>
          <strong>{compact ? "게임 방법이 궁금할 때" : "처음 해도 괜찮아요"}</strong>
          {!compact && <p>{copy.summary}</p>}
        </div>
        <DialogTrigger asChild>
          <button
            type="button"
            className={styles.launch}
            aria-label={`${copy.title} 게임 방법 보기`}
          >
            {compact ? "게임 방법" : "설명·튜토리얼"}
            <ArrowRight size={14} />
          </button>
        </DialogTrigger>
      </div>
      <DialogContent className={styles.dialog}>
        <header className={styles.heading}>
          <span>
            <BookOpen size={15} /> PLAY GUIDE
          </span>
          <DialogTitle className={styles.title}>{copy.title} 플레이 가이드</DialogTitle>
        </header>
        <div className={styles.scroll} data-tutorial-scroll tabIndex={0}>
          <div className={styles.overview}>
            <DialogDescription className={styles.description}>{copy.summary}</DialogDescription>
            <div className={styles.facts}>
              {copy.facts.map((text) => (
                <span key={text}>{text}</span>
              ))}
            </div>
          </div>
          {inProgress && (
            <p className={styles.running}>
              <Clock3 size={14} /> 설명을 보는 동안에도 실제 게임은 계속 진행돼요.
            </p>
          )}
          <section className={styles.goal}>
            <span>이 게임의 목표</span>
            <p>{copy.goal}</p>
          </section>
          <div className={styles.audience} role="group" aria-label="설명 대상">
            {(["player", "host"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={role === value}
                onClick={() => {
                  setRole(value);
                  setStep(0);
                }}
              >
                {value === "player" ? "참가자 설명" : "진행자 설명"}
              </button>
            ))}
          </div>
          <div className={styles.walkthrough}>
            <nav className={styles.stepNav} aria-label="튜토리얼 단계">
              <ol>
                {steps.map((item, index) => (
                  <li key={item.title}>
                    <button
                      type="button"
                      aria-label={`${index + 1}단계: ${item.title}`}
                      aria-current={step === index ? "step" : undefined}
                      onClick={() => setStep(index)}
                    >
                      <span>{index + 1}</span>
                      <small>{item.title}</small>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
            <section id={id} className={styles.stepBody} aria-live="polite" aria-atomic="true">
              <small>
                STEP {String(step + 1).padStart(2, "0")} / {steps.length}
              </small>
              <h3>{current.title}</h3>
              <p>{current.body}</p>
              <div className={styles.action}>
                <Play size={15} />
                <div>
                  <span>이렇게 눌러보세요</span>
                  <strong>{current.action}</strong>
                </div>
              </div>
            </section>
          </div>
          <div className={styles.controls}>
            <button
              type="button"
              className={styles.previous}
              disabled={step === 0}
              onClick={() => setStep((v) => Math.max(0, v - 1))}
            >
              <ArrowLeft size={15} />
              이전
            </button>
            <span>
              {step + 1} / {steps.length}
            </span>
            {step < steps.length - 1 ? (
              <button type="button" className={styles.next} onClick={() => setStep((v) => v + 1)}>
                다음 단계
                <ArrowRight size={15} />
              </button>
            ) : (
              <button type="button" className={styles.next} onClick={() => changeOpen(false)}>
                확인했어요
                <Check size={15} />
              </button>
            )}
          </div>
          <PracticeExample key={game} game={game} />
          <section className={styles.finish}>
            <ShieldCheck size={17} />
            <div>
              <strong>끝나는 조건</strong>
              <p>{copy.finish}</p>
            </div>
          </section>
          <details className={styles.tips}>
            <summary>
              <Lightbulb size={15} /> 처음이라면 이것만 기억해요
            </summary>
            <ul>
              {copy.tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          </details>
          <section className={styles.faq} aria-label="게임 자주 묻는 질문">
            <h3>자주 묻는 질문</h3>
            {copy.questions.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </section>
          <p className={styles.footnote}>
            설명과 연습은 실제 정답·배정·머니·준비 상태를 바꾸지 않아요. 닫은 뒤 원래 화면에서
            계속할 수 있어요.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
