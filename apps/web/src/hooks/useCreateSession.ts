import type { PlayPayload } from '@memorix/shared';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { type PlaySource, savePlayCache } from '../lib/playCache';

// POST /api/sessions: quizSetId または shareToken のどちらか一方（§8.1）。
// 成功したら PlayPayload をクライアントにキャッシュし /play/:sessionId へ遷移する。
export function useCreateSession() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (source: PlaySource) => api.post<PlayPayload>('/sessions', source),
    onSuccess: (payload, source) => {
      savePlayCache(payload.sessionId, { payload, source });
      navigate(`/play/${payload.sessionId}`);
    },
  });
}
