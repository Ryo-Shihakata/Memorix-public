import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { z } from 'zod';
import { apiError } from './errors';

// zValidator のエラーを §7 共通のエラー形式 {error: {code, message}} に揃えるラッパ
export const zv = <Target extends keyof ValidationTargets, S extends z.ZodType>(
  target: Target,
  schema: S,
) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return apiError(c, 400, 'VALIDATION', '入力内容が正しくありません。');
    }
  });
