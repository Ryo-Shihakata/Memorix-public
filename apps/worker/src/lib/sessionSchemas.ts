import { z } from 'zod';

// POST /api/sessions: quizSetId または shareToken のどちらか一方が必須（§8.1）
export const createSessionSchema = z
  .object({
    quizSetId: z.string().length(32).optional(),
    shareToken: z.string().min(1).max(200).optional(),
  })
  .refine((data) => (data.quizSetId ? 1 : 0) + (data.shareToken ? 1 : 0) === 1, {
    message: 'quizSetIdまたはshareTokenのいずれか一方が必要です。',
  });

// POST /api/sessions/:id/submit: §8.2。配列の上限は仕様書に明記が無いため、
// 判断としてBLANKS_PER_QUESTION×QUESTIONS_PER_QUIZ相当の実用上限を採用
const answerInputSchema = z.object({
  blankId: z.string().length(32),
  answer: z.string().max(500),
  timeToAnswerMs: z.number().int().min(0).optional(),
});

export const submitAnswersSchema = z.object({
  answers: z.array(answerInputSchema).max(10_000),
});
