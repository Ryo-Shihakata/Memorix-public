import { useSearchParams } from 'react-router-dom';

export function Login() {
  const [params] = useSearchParams();
  const redirectTo = params.get('redirect_to') ?? '/';

  function loginUrl(provider: 'google' | 'microsoft') {
    return `/api/auth/${provider}?redirect_to=${encodeURIComponent(redirectTo)}`;
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6 p-8 text-center">
      <h1 className="text-2xl font-bold text-indigo-600">Memorixにログイン</h1>
      <p className="text-sm text-gray-500">
        クイズの作成・ブックマーク・フォローにはログインが必要です。
      </p>
      <div className="flex w-full flex-col gap-3">
        <a
          href={loginUrl('google')}
          className="w-full rounded-full border border-gray-300 bg-white py-2.5 text-sm font-medium text-gray-700 hover:border-gray-400"
        >
          Googleでログイン
        </a>
        <a
          href={loginUrl('microsoft')}
          className="w-full rounded-full border border-gray-300 bg-white py-2.5 text-sm font-medium text-gray-700 hover:border-gray-400"
        >
          Microsoftでログイン
        </a>
      </div>
    </div>
  );
}
