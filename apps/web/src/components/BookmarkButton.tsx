import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../hooks/useMe';
import { api, isUnauthorized } from '../lib/api';

// クイズ単位の「現在ブックマーク済みか」を返す軽量APIが無いため、
// このボタンはローカルの楽観的状態のみで表示を切り替える（初期状態は常に未登録）。
// 正確な状態確認・フォルダ選択は /bookmarks 画面（フォルダサイドバー）で行う。
export function BookmarkButton({ quizSetId }: { quizSetId: string }) {
  const { data: me, error: meError } = useMe();
  const [bookmarked, setBookmarked] = useState(false);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      bookmarked
        ? api.delete(`/quiz-sets/${quizSetId}/bookmark`)
        : api.put(`/quiz-sets/${quizSetId}/bookmark`, {}),
    onSuccess: () => {
      setBookmarked((v) => !v);
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
    },
  });

  if (!me || isUnauthorized(meError)) {
    return (
      <Link
        to="/login"
        className="rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:border-indigo-400"
      >
        ブックマーク
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
        bookmarked
          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
          : 'border-gray-300 text-gray-600 hover:border-indigo-400'
      }`}
    >
      {bookmarked ? '★ ブックマーク済み' : '☆ ブックマーク'}
    </button>
  );
}
