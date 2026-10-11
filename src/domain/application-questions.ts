import { z } from "zod";

export const applicationQuestionSchema = z
  .object({
    id: z.uuid().transform((id) => id.toLowerCase()),
    prompt: z.string().trim().min(1).max(160),
    type: z.enum(["text", "single_choice"]),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  })
  .strict()
  .superRefine((question, ctx) => {
    if (question.type === "text" && question.options.length)
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "주관식 질문에는 선택지를 추가할 수 없어요.",
      });
    if (question.type === "single_choice" && question.options.length < 2)
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "선택형 질문에는 2개 이상의 선택지가 필요해요.",
      });
    if (new Set(question.options).size !== question.options.length)
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "같은 선택지를 중복해서 추가할 수 없어요.",
      });
  });

export const applicationQuestionsSchema = z
  .array(applicationQuestionSchema)
  .max(10)
  .superRefine((questions, ctx) => {
    if (new Set(questions.map((question) => question.id)).size !== questions.length)
      ctx.addIssue({ code: "custom", message: "질문 식별자는 서로 달라야 해요." });
  });
export const submittedAnswersSchema = z
  .array(
    z
      .object({
        questionId: z.uuid().transform((id) => id.toLowerCase()),
        value: z.string().trim().max(1000),
      })
      .strict(),
  )
  .max(10)
  .superRefine((answers, ctx) => {
    if (new Set(answers.map((answer) => answer.questionId)).size !== answers.length)
      ctx.addIssue({ code: "custom", message: "같은 질문에 중복 답변할 수 없어요." });
  });
export type ApplicationQuestion = z.infer<typeof applicationQuestionSchema>;
export type SubmittedAnswer = z.infer<typeof submittedAnswersSchema>[number];
export interface ApplicationAnswerSnapshot {
  questionId: string;
  prompt: string;
  type: ApplicationQuestion["type"];
  options: string[];
  answer: string;
}

// Snapshot every displayed question, including optional questions left blank.
// Later edits to the organizer's questions never rewrite a submitted answer.
export function snapshotApplicationAnswers(
  questions: readonly ApplicationQuestion[],
  input: unknown,
): ApplicationAnswerSnapshot[] {
  const known = new Map(questions.map((question) => [question.id, question]));
  const answers = submittedAnswersSchema
    .superRefine((values, ctx) => {
      const submitted = new Map(values.map((answer) => [answer.questionId, answer.value]));
      for (const [index, answer] of values.entries()) {
        const question = known.get(answer.questionId);
        if (!question) {
          ctx.addIssue({
            code: "custom",
            path: [index, "questionId"],
            message: "현재 신청서에 없는 질문이에요. 새로고침 후 다시 신청해주세요.",
          });
          continue;
        }
        if (
          question.type === "single_choice" &&
          answer.value &&
          !question.options.includes(answer.value)
        )
          ctx.addIssue({
            code: "custom",
            path: [index, "value"],
            message: "등록된 선택지 중에서 답변을 선택해주세요.",
          });
      }
      for (const question of questions)
        if (question.required && !submitted.get(question.id))
          ctx.addIssue({ code: "custom", message: `필수 질문에 답변해주세요: ${question.prompt}` });
    })
    .parse(input);
  const submitted = new Map(answers.map((answer) => [answer.questionId, answer.value]));
  return questions.map((question) => ({
    questionId: question.id,
    prompt: question.prompt,
    type: question.type,
    options: [...question.options],
    answer: submitted.get(question.id) ?? "",
  }));
}
