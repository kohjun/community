"use client";
import { Plus, Trash2, ClipboardList } from "lucide-react";
import type { ApplicationQuestion } from "./application-question-fields";

// getRandomValues is available on local HTTP LAN pages where randomUUID may not be.
function newQuestionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function EventQuestionEditor({
  questions,
  onChange,
  disabled = false,
}: {
  questions: ApplicationQuestion[];
  onChange: (questions: ApplicationQuestion[]) => void;
  disabled?: boolean;
}) {
  function update(id: string, change: Partial<ApplicationQuestion>) {
    onChange(
      questions.map((question) => (question.id === id ? { ...question, ...change } : question)),
    );
  }
  function add() {
    if (questions.length >= 10) return;
    onChange([
      ...questions,
      {
        id: newQuestionId(),
        prompt: "",
        type: "text",
        required: true,
        options: [],
      },
    ]);
  }
  return (
    <section className="event-question-editor" aria-label="참가 질문 설정">
      <div className="event-question-editor-heading">
        <div>
          <h3>
            <ClipboardList size={16} aria-hidden />
            참가자에게 물어볼 질문
          </h3>
          <p>
            질문은 최대 10개까지 만들 수 있어요. 닉네임과 연락처는 회원정보에서 자동으로 전달돼요.
          </p>
        </div>
        <small>{questions.length} / 10</small>
      </div>
      {questions.map((question, index) => (
        <fieldset disabled={disabled} className="event-question-edit-card" key={question.id}>
          <legend>질문 {index + 1}</legend>
          <div className="event-question-edit-toolbar">
            <label>
              답변 방식
              <select
                value={question.type}
                onChange={(event) => {
                  const type = event.target.value as ApplicationQuestion["type"];
                  update(question.id, {
                    type,
                    options:
                      type === "single_choice"
                        ? question.options.length >= 2
                          ? question.options
                          : ["", ""]
                        : [],
                  });
                }}
              >
                <option value="text">직접 입력</option>
                <option value="single_choice">하나 선택</option>
              </select>
            </label>
            <button
              type="button"
              className="event-question-remove"
              disabled={disabled}
              aria-label={`질문 ${index + 1} 삭제`}
              onClick={() => onChange(questions.filter((item) => item.id !== question.id))}
            >
              <Trash2 size={15} aria-hidden />
            </button>
          </div>
          <label>
            질문 내용
            <input
              required
              maxLength={160}
              value={question.prompt}
              onChange={(event) => update(question.id, { prompt: event.target.value })}
              placeholder="예: 이번 모임에서 기대하는 점은 무엇인가요?"
            />
          </label>
          {question.type === "single_choice" && (
            <div className="event-question-options">
              <span>
                선택지 <small>2~8개 · 같은 선택지는 사용할 수 없어요</small>
              </span>
              {question.options.map((option, optionIndex) => (
                <div className="event-question-option" key={optionIndex}>
                  <label>
                    <span className="sr-only">
                      질문 {index + 1} 선택지 {optionIndex + 1}
                    </span>
                    <input
                      required
                      maxLength={80}
                      value={option}
                      onChange={(event) =>
                        update(question.id, {
                          options: question.options.map((value, i) =>
                            i === optionIndex ? event.target.value : value,
                          ),
                        })
                      }
                      placeholder={`선택지 ${optionIndex + 1}`}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={disabled || question.options.length <= 2}
                    aria-label={`선택지 ${optionIndex + 1} 삭제`}
                    onClick={() =>
                      update(question.id, {
                        options: question.options.filter((_, i) => i !== optionIndex),
                      })
                    }
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="participation-text-link"
                disabled={disabled || question.options.length >= 8}
                onClick={() => update(question.id, { options: [...question.options, ""] })}
              >
                <Plus size={14} aria-hidden /> 선택지 추가
              </button>
            </div>
          )}
          <label className="participation-checkbox event-question-required">
            <input
              type="checkbox"
              checked={question.required}
              onChange={(event) => update(question.id, { required: event.target.checked })}
            />
            답변을 필수로 받기
          </label>
        </fieldset>
      ))}
      <button
        type="button"
        className="participation-secondary event-question-add"
        disabled={disabled || questions.length >= 10}
        onClick={add}
      >
        <Plus size={15} aria-hidden /> 질문 추가
      </button>
      <p className="event-question-snapshot-note">
        질문을 변경해도 이미 제출된 참가자의 질문과 답변은 신청 당시 내용으로 보관돼요.
      </p>
    </section>
  );
}
