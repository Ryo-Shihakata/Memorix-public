// §12.3 実装規約: fetch ラッパ（credentials: 'include'、エラー時 error.code で分岐）。
import type { ApiError } from '@memorix/shared';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiError['error']['code'];

  constructor(status: number, code: ApiError['error']['code'], message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  isFormData?: boolean;
}

const DEFAULT_ERROR_MESSAGE = '通信エラーが発生しました。しばらくしてから再度お試しください。';

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, isFormData } = options;
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (isFormData) {
    payload = body as FormData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers,
      body: payload,
    });
  } catch {
    throw new ApiRequestError(0, 'VALIDATION', DEFAULT_ERROR_MESSAGE);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get('content-type') ?? '';
  const data: unknown = contentType.includes('application/json') ? await res.json() : undefined;

  if (!res.ok) {
    const err = data as ApiError | undefined;
    const code = err?.error?.code ?? 'VALIDATION';
    const message = err?.error?.message ?? DEFAULT_ERROR_MESSAGE;
    throw new ApiRequestError(res.status, code, message);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: 'POST', body }),
  postForm: <T>(path: string, form: FormData): Promise<T> =>
    request<T>(path, { method: 'POST', body: form, isFormData: true }),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'DELETE', body }),
};

// 未ログイン時に想定される401（オプショナルな個人化取得等）かどうかの判定に使う。
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return DEFAULT_ERROR_MESSAGE;
}
