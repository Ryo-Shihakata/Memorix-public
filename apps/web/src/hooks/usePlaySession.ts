import type { SubmitResult } from '@memorix/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiRequestError, api } from '../lib/api';
import { clearDraft, loadDraft, saveDraft } from '../lib/draft';
import { loadPlayCache, type PlayCacheEntry } from '../lib/playCache';

const DRAFT_DEBOUNCE_MS = 500;
const MAX_AUTO_RETRIES = 5;

export type SubmitStatus = 'idle' | 'submitting' | 'error';

// §8.4 入力保護: draft の debounce 保存/復元、回答時間計測、提出リトライ（指数バックオフ最大5回）を担う。
export function usePlaySession(sessionId: string) {
  const navigate = useNavigate();
  const cacheRef = useRef<PlayCacheEntry | null | undefined>(undefined);
  if (cacheRef.current === undefined) {
    cacheRef.current = loadPlayCache(sessionId);
  }
  const cache = cacheRef.current;

  const initialDraft = useRef(loadDraft(sessionId));
  const [answers, setAnswers] = useState<Record<string, string>>(initialDraft.current.answers);
  const focusedAtRef = useRef<Record<string, number>>(initialDraft.current.focusedAt);
  const lastInputAtRef = useRef<Record<string, number>>({});

  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // draft を debounce 500ms で保存（§8.4）。
  useEffect(() => {
    const timer = setTimeout(() => {
      saveDraft(sessionId, { answers, focusedAt: focusedAtRef.current });
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [answers, sessionId]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  const onFocusBlank = useCallback((blankId: string) => {
    if (focusedAtRef.current[blankId] === undefined) {
      focusedAtRef.current[blankId] = Date.now();
    }
  }, []);

  const onChangeBlank = useCallback((blankId: string, value: string) => {
    if (focusedAtRef.current[blankId] === undefined) {
      focusedAtRef.current[blankId] = Date.now();
    }
    lastInputAtRef.current[blankId] = Date.now();
    setAnswers((prev) => ({ ...prev, [blankId]: value }));
  }, []);

  const totalCount = cache ? cache.payload.questions.reduce((n, q) => n + q.blanks.length, 0) : 0;
  const filledCount = cache
    ? cache.payload.questions.reduce(
        (n, q) => n + q.blanks.filter((b) => (answers[b.id] ?? '').trim() !== '').length,
        0,
      )
    : 0;

  const doSubmit = useCallback(async () => {
    if (!cache) return;
    setSubmitStatus('submitting');
    setSubmitError(null);

    const answerList = cache.payload.questions.flatMap((q) =>
      q.blanks.map((b) => {
        const focused = focusedAtRef.current[b.id];
        const last = lastInputAtRef.current[b.id];
        const timeToAnswerMs =
          focused !== undefined && last !== undefined ? Math.max(0, last - focused) : undefined;
        return {
          blankId: b.id,
          answer: answers[b.id] ?? '',
          timeToAnswerMs,
        };
      }),
    );

    try {
      await api.post<SubmitResult>(`/sessions/${sessionId}/submit`, { answers: answerList });
      retryCountRef.current = 0;
      clearDraft(sessionId);
      navigate(`/result/${sessionId}`);
    } catch (e) {
      // 二重提出（既に採点済み）は結果画面へ誘導すればよい。
      if (e instanceof ApiRequestError && e.status === 409) {
        clearDraft(sessionId);
        navigate(`/result/${sessionId}`);
        return;
      }
      // 4xx（validation等、409以外）はリトライしても解決しないため自動リトライしない。
      if (e instanceof ApiRequestError && e.status >= 400 && e.status < 500) {
        setSubmitStatus('error');
        setSubmitError(e.message);
        return;
      }
      // ネットワークエラー/5xx: 指数バックオフで自動リトライ（最大5回）。
      setSubmitStatus('error');
      setSubmitError(e instanceof Error ? e.message : '通信エラーが発生しました。');
      if (retryCountRef.current < MAX_AUTO_RETRIES) {
        const delay = Math.min(2 ** retryCountRef.current * 1000, 16_000);
        retryCountRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
          void doSubmit();
        }, delay);
      }
    }
  }, [cache, sessionId, navigate, answers]);

  const submit = useCallback(() => {
    void doSubmit();
  }, [doSubmit]);

  const retrySubmit = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    void doSubmit();
  }, [doSubmit]);

  return {
    cache,
    answers,
    onFocusBlank,
    onChangeBlank,
    filledCount,
    totalCount,
    submitStatus,
    submitError,
    submit,
    retrySubmit,
  };
}
