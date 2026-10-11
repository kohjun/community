"use client";
import Link from "next/link";
import { CheckCircle2, UserRound } from "lucide-react";
import { useId } from "react";

import type {
  ApplicationQuestion,
  SubmittedAnswer as ApplicationAnswer,
  ApplicationAnswerSnapshot,
} from "@/domain/application-questions";
export type {
  ApplicationQuestion,
  SubmittedAnswer as ApplicationAnswer,
  ApplicationAnswerSnapshot,
} from "@/domain/application-questions";
export function questionAnswers(
  questions: ApplicationQuestion[],
  answers: ApplicationAnswer[],
): ApplicationAnswer[] {
  return questions.map((question) => {
    const value = answers.find((answer) => answer.questionId === question.id)?.value ?? "";
    return {
      questionId: question.id,
      value: question.type === "single_choice" && !question.options.includes(value) ? "" : value,
    };
  });
}
export function ApplicationQuestionFields({
  questions,
  answers,
  onChange,
  disabled = false,
}: {
  questions: ApplicationQuestion[];
  answers: ApplicationAnswer[];
  onChange: (answers: ApplicationAnswer[]) => void;
  disabled?: boolean;
}) {
  const prefix = useId();
  function update(questionId: string, value: string) {
    onChange([
      ...answers.filter((answer) => answer.questionId !== questionId),
      { questionId, value },
    ]);
  }
  if (!questions.length) return null;
  return (
    <section className="application-questions" aria-label="행사 참가 질문">
      <div className="application-question-heading">
        <h3>참가 전 질문</h3>
        <p>담당자가 준비한 질문이에요. 답변은 해당 행사 담당자만 확인할 수 있어요.</p>
      </div>
      {questions.map((question, index) => {
        const inputId = `${prefix}-${question.id}`;
        const answer = answers.find((item) => item.questionId === question.id)?.value ?? "";
        const value =
          question.type === "single_choice" && !question.options.includes(answer) ? "" : answer;
        return (
          <div className="application-question" key={question.id}>
            <label htmlFor={inputId}>
              <span className="application-question-number">{index + 1}</span>
              <span>{question.prompt}</span>
              <small className={question.required ? "is-required" : ""}>
                {question.required ? "필수" : "선택"}
              </small>
            </label>
            {question.type === "text" ? (
              <textarea
                id={inputId}
                required={question.required}
                maxLength={1000}
                rows={3}
                disabled={disabled}
                value={value}
                onChange={(event) => update(question.id, event.target.value)}
                placeholder="답변을 입력해주세요"
              />
            ) : (
              <select
                id={inputId}
                required={question.required}
                disabled={disabled}
                value={value}
                onChange={(event) => update(question.id, event.target.value)}
              >
                <option value="">답변을 선택해주세요</option>
                {question.options.map((option) => (
                  <option value={option} key={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </section>
  );
}
function maskedPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8 ? `${digits.slice(0, 3)}-****-${digits.slice(-4)}` : "등록된 연락처";
}
export function ApplicantProfileSummary({
  profile,
  postId,
}: {
  profile: { nickname: string; phoneNumber: string | null; ready: boolean } | null;
  postId: string;
}) {
  if (!profile?.ready) {
    const returnTo = encodeURIComponent(`/events/${postId}`);
    return (
      <section className="applicant-profile applicant-profile-incomplete">
        <UserRound size={20} aria-hidden />
        <div>
          <strong>참가 전 기본정보를 완성해주세요</strong>
          <p>닉네임과 연락처를 한 번 등록하면 다음 모임에서도 그대로 사용할 수 있어요.</p>
          <Link className="participation-primary" href={`/signup?returnTo=${returnTo}`}>
            기본정보 등록하기
          </Link>
        </div>
      </section>
    );
  }
  return (
    <section className="applicant-profile" aria-label="참가에 사용할 내 기본정보">
      <UserRound size={20} aria-hidden />
      <div>
        <strong>{profile.nickname}</strong>
        <p>{profile.phoneNumber ? maskedPhone(profile.phoneNumber) : "연락처 등록됨"}</p>
        <small>
          내 정보가 자동으로 입력돼요. 담당자에게는 등록된 닉네임과 연락처가 전달됩니다.
        </small>
      </div>
      <Link href={`/signup?returnTo=${encodeURIComponent(`/events/${postId}`)}`}>수정</Link>
    </section>
  );
}
export function SubmittedApplicationDetails({
  answers,
  note,
  completed = true,
}: {
  answers: ApplicationAnswerSnapshot[];
  note: string;
  completed?: boolean;
}) {
  if (!answers.length && !note && completed) return null;
  return (
    <details className="application-response-details">
      <summary>
        <CheckCircle2 size={15} aria-hidden />
        질문 답변 · 요청사항
        {!completed && <small>답변 대기</small>}
      </summary>
      {!completed && <p>참가자가 질문 답변과 정보 제공 동의를 아직 제출하지 않았어요.</p>}
      <dl>
        {answers.map((answer) => (
          <div key={answer.questionId}>
            <dt>{answer.prompt}</dt>
            <dd>{answer.answer || "답변 없음"}</dd>
          </div>
        ))}
        {note && (
          <div>
            <dt>참가 요청사항</dt>
            <dd>{note}</dd>
          </div>
        )}
      </dl>
    </details>
  );
}
