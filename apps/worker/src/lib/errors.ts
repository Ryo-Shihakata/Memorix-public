import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'PAYLOAD_TOO_LARGE'
  | 'BANNED'
  | 'LAST_OWNER';

// §7 共通規約: { error: { code, message(日本語) } }
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: ApiErrorCode,
  message: string,
): Response {
  return c.json({ error: { code, message } }, status);
}
