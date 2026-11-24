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
import type { ClueMode, DrawingMode } from "@/domain/creative-games";
import type { TemperatureMode } from "@/domain/temperature-game";
import type { ToastMode } from "@/domain/toast-game";
import styles from "./game-tutorial.module.css";

/** A worked 낙서톡 example per mode, drawn as the chain players will actually see. */
const DRAWING_EXAMPLES: Record<
  DrawingMode,
  { items: { tag: string; text: string }[]; note: string }
> = {
  live: {
    items: [
      { tag: "제시어", text: "우산 쓴 고양이" },
      { tag: "그리는 중", text: "🎨 고양이 + 우산" },
      { tag: "지연의 답", text: "고양이? (아직)" },
      { tag: "현우의 답", text: "우산 쓴 고양이 ✅" },
    ],
    note: "현우가 먼저 맞혀서 2점, 그린 사람도 1점을 받아요.",
  },
  mix: {
    items: [
      { tag: "처음 문장", text: "떡볶이를 먹는 펭귄" },
      { tag: "그림", text: "🎨 빨간 음식을 든 새" },
      { tag: "그림 보고 쓴 문장", text: "치킨을 들고 있는 오리" },
      { tag: "다 같이 맞히기", text: "정답: 치킨을 들고 있는 오리" },
    ],
    note: "정답은 처음 문장이 아니라 바뀐 마지막 문장 ‘치킨을 들고 있는 오리’예요.",
  },
  relay: {
    items: [
      { tag: "처음 문장", text: "떡볶이를 먹는 펭귄" },
      { tag: "그림", text: "🎨 빨간 음식을 든 새" },
      { tag: "그림 보고 쓴 문장", text: "치킨을 들고 있는 오리" },
      { tag: "재미 투표", text: "🗳️ 가장 웃긴 이야기에 한 표" },
    ],
    note: "맞히기와 점수 없이, 이야기가 바뀌는 과정을 함께 보며 웃어요.",
  },
};

/** A worked 단서각 round per mode. */
const CLUE_EXAMPLES: Record<ClueMode, { items: { tag: string; text: string }[]; note: string }> = {
  quiz: {
    items: [
      { tag: "거리뷰", text: "🏙️ 큰 성문과 넓은 도로" },
      { tag: "보기", text: "A 숭례문 · B 광화문 · C 장안문 · D 첨성대" },
      { tag: "내 선택", text: "B 광화문" },
      { tag: "정답 공개", text: "B 광화문 ✅ +1점" },
    ],
    note: "맞힌 사람은 모두 1점이에요. 간판·표지판·건물 모양을 잘 살펴보세요.",
  },
  photo: {
    items: [
      { tag: "거리뷰", text: "🌊 바다와 긴 모래사장" },
      { tag: "내 핀", text: "📍 부산 해운대 근처" },
      { tag: "정답 공개", text: "해운대 해수욕장 · 내 핀까지 1.2km" },
      { tag: "점수", text: "가장 가까운 사람 +1점" },
    ],
    note: "정확히 몰라도 괜찮아요. 다른 사람보다 가까우면 1점이에요.",
  },
  zoom: {
    items: [
      { tag: "처음", text: "🔍 간판 일부만 크게" },
      { tag: "조금 뒤", text: "🔎 건물이 보이기 시작" },
      { tag: "마지막", text: "🏙️ 거리 전체가 보여요" },
      { tag: "정답 공개", text: "가장 가까운 핀 +1점" },
    ],
    note: "빨리 내도 추가 점수는 없어요. 충분히 넓어지면 내도 괜찮아요.",
  },
  member: {
    items: [
      { tag: "대기실", text: "📸 각자 사진 1장 + 찍은 곳 등록" },
      { tag: "문제", text: "누군가의 카페 사진" },
      { tag: "내 답", text: "📍 성수동 · 사진 주인: 지연님" },
      { tag: "정답 공개", text: "위치 1점 + 주인 1점" },
    ],
    note: "내 사진이 나오면 쉬어요. 결과가 나오면 사진에 얽힌 이야기를 나눠봐요.",
  },
};

/** A worked 마음의 온도 turn per mode. */
const TEMPERATURE_EXAMPLES: Record<TemperatureMode, FlowExample> = {
  basic: {
    items: [
      { tag: "주제", text: "얼마나 당황스러운 상황인가요? (0 전혀 ↔ 100 매우)" },
      { tag: "비밀 숫자", text: "🔒 80 · 설명하는 지연님만 봐요" },
      { tag: "지연님의 설명", text: "🗣️ “발표 중에 노트북이 꺼졌어요”" },
      { tag: "모두의 답", text: "현우 75 · 민지 50" },
      { tag: "결과", text: "정답 80 → 가장 가까운 현우님 +1점" },
    ],
    note: "설명하는 사람은 숫자를 직접 말하면 안 돼요. 상황으로만 설명해요.",
  },
  deduction: {
    items: [
      { tag: "주제", text: "얼마나 당황스러운 상황인가요? (0 전혀 ↔ 100 매우)" },
      { tag: "몰래 쓴 상황", text: "지연: 엘리베이터에 갇힘(85) · 현우: 단톡방 오타(20)" },
      { tag: "내가 세운 줄", text: "단톡방 오타 → 엘리베이터에 갇힘" },
      { tag: "결과", text: "실제 순서와 같아요 ✅ +1점" },
    ],
    note: "줄을 세울 때는 이름과 상황만 보여요. 숫자는 결과에서 공개돼요.",
  },
};

/** A worked 건배의 눈치 question per mode (4 players). */
const TOAST_EXAMPLES: Record<ToastMode, FlowExample> = {
  basic: {
    items: [
      { tag: "지연님의 질문", text: "💬 “나는 아침형 인간이다”" },
      { tag: "지연님의 예상", text: "🤔 나 포함 2명이 건배할 것 같아" },
      { tag: "모두 몰래 선택", text: "🥂 건배 2명 · 🙅 패스 2명" },
      { tag: "결과", text: "예상 2명 = 실제 2명 → 지연님 +1점" },
    ],
    note: "누가 건배했는지는 공개하지 않아요. 인원만 보고 서로 추측해봐요.",
  },
  target: {
    items: [
      { tag: "비밀 목표", text: "🎯 건배 3명 · 질문자 지연님만 봐요" },
      { tag: "지연님의 질문", text: "💬 “나는 매운 음식을 잘 먹는다”" },
      { tag: "모두 몰래 선택", text: "🥂 건배 3명 · 🙅 패스 1명" },
      { tag: "결과", text: "목표 3명 = 실제 3명 → 지연님 +1점" },
    ],
    note: "목표에 맞게 너무 쉽지도, 어렵지도 않은 질문을 만드는 게 핵심이에요.",
  },
};

type FlowExample = { items: { tag: string; text: string }[]; note: string };
function flowExample(game: TutorialGame, variant?: string): FlowExample | null {
  if (game === "drawing")
    return DRAWING_EXAMPLES[
      variant && variant in DRAWING_EXAMPLES ? (variant as DrawingMode) : "mix"
    ];
  if (game === "clue")
    return CLUE_EXAMPLES[variant && variant in CLUE_EXAMPLES ? (variant as ClueMode) : "photo"];
  if (game === "temperature")
    return TEMPERATURE_EXAMPLES[variant === "deduction" ? "deduction" : "basic"];
  if (game === "toast") return TOAST_EXAMPLES[variant === "target" ? "target" : "basic"];
  return null;
}

function PracticeExample({ game, variant }: { game: TutorialGame; variant?: string | undefined }) {
  const [showCounts, setShowCounts] = useState(false),
    [votes, setVotes] = useState(3),
    [sale, setSale] = useState<number | null>(140);
  if (game === "snap-pang")
    return (
      <div className={styles.practice}>
        <strong>🎨 색깔 · 📦 물건 · 😆 표정 · 🎲 랜덤 모드</strong>
        <p>
          카메라 인식은 모두 내 스마트폰 안에서만 처리돼요. 표정 라운드에서는 원하면 내 얼굴 대신 3D
          아바타만 보이게 가릴 수 있어요. 모든 라운드는 카메라로 진행해요.
        </p>
      </div>
    );
  const example = flowExample(game, variant);
  if (example)
    return (
      <div className={styles.practice}>
        <strong>예시로 보면 이렇게 흘러가요</strong>
        <ol className={styles.flowChain}>
          {example.items.map((item) => (
            <li key={item.tag}>
              <small>{item.tag}</small>
              <span>{item.text}</span>
            </li>
          ))}
        </ol>
        <p>{example.note}</p>
      </div>
    );
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
        {game === "mbti-intro" ? (
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
  variant,
  revealLiar,
  audience = "player",
  compact = false,
  inProgress = false,
}: {
  game: TutorialGame;
  wordMode?: WordMode | undefined;
  /** The chosen game mode (낙서톡·단서각·마음의온도·눈치게임): explain just this mode. */
  variant?: string | undefined;
  revealLiar?: boolean | undefined;
  audience?: TutorialAudience;
  compact?: boolean;
  inProgress?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [role, setRole] = useState(audience),
    [step, setStep] = useState(0);
  const id = useId(),
    copy = getGameTutorial(game, wordMode, revealLiar, variant);
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
          <PracticeExample key={`${game}-${variant ?? ""}`} game={game} variant={variant} />
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
