import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { QueryState } from '../components/QueryState';
import { api, errorMessage } from '../lib/api';

interface InvitePreview {
  teamName: string;
  role: 'editor' | 'viewer';
}

interface AcceptResult {
  teamId: string;
  role: 'editor' | 'viewer';
}

const ROLE_LABEL: Record<InvitePreview['role'], string> = {
  editor: '編集者',
  viewer: '閲覧者',
};

export function InviteAccept() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<InvitePreview>(`/invites/${token}`),
  });

  const accept = useMutation({
    mutationFn: () => api.post<AcceptResult>(`/invites/${token}/accept`),
    onSuccess: (result) => navigate(`/teams/${result.teamId}`),
  });

  if (isLoading || isError || !data) {
    return (
      <QueryState
        isLoading={isLoading}
        isError={isError || !data}
        errorLabel="招待リンクが見つからないか、無効になっています。"
        onRetry={refetch}
        className="p-4"
      />
    );
  }

  return (
    <div className="mx-auto max-w-sm space-y-4 p-6 text-center">
      <h1 className="text-lg font-bold text-gray-900">チームへの招待</h1>
      <p className="text-sm text-gray-600">
        「{data.teamName}」に{ROLE_LABEL[data.role]}として参加しますか？
      </p>
      {accept.isError && <p className="text-sm text-red-600">{errorMessage(accept.error)}</p>}
      <button
        type="button"
        onClick={() => accept.mutate()}
        disabled={accept.isPending}
        className="w-full rounded-full bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {accept.isPending ? '参加中…' : '参加する'}
      </button>
    </div>
  );
}
