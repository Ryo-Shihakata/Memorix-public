import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import {
  clientCredentials,
  exchangeCode,
  extractClaims,
  isProvider,
  OAuthError,
  PROVIDERS,
  type Provider,
  verifyIdToken,
} from '../lib/oauth';
import {
  clearSessionCookie,
  createSession,
  SESSION_COOKIE,
  sessionCookie,
  sessionKey,
} from '../lib/session';
import { resolveUser } from '../lib/users';

interface OAuthState {
  provider: Provider;
  redirectTo: string;
}

const OAUTH_STATE_TTL_SECONDS = 600; // 10分

// オープンリダイレクト対策（§5.1 手順6）: 同一オリジンのパスのみ許可。
// `//` 始まりや `http` 始まり（非パス）は `/` に置換する。
function sanitizeRedirectTo(value: string | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//')) {
    return '/';
  }
  return value;
}

function redirectUri(appOrigin: string, provider: Provider): string {
  return `${appOrigin}/api/auth/${provider}/callback`;
}

const auth = new Hono<AppEnv>();

// §5.1 手順1: state 生成 → KV 保存 → プロバイダへ 302
auth.get('/:provider', async (c) => {
  const provider = c.req.param('provider');
  if (!isProvider(provider)) {
    return apiError(c, 404, 'NOT_FOUND', '未対応の認証プロバイダです。');
  }
  const redirectTo = sanitizeRedirectTo(c.req.query('redirect_to'));
  const state = crypto.randomUUID();
  await c.env.KV.put(
    `oauth:${state}`,
    JSON.stringify({ provider, redirectTo } satisfies OAuthState),
    { expirationTtl: OAUTH_STATE_TTL_SECONDS },
  );

  const cfg = PROVIDERS[provider];
  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set('client_id', clientCredentials(c.env, provider).id);
  url.searchParams.set('redirect_uri', redirectUri(c.env.APP_ORIGIN, provider));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  return c.redirect(url.toString(), 302);
});

// §5.1 手順2〜6
auth.get('/:provider/callback', async (c) => {
  const provider = c.req.param('provider');
  if (!isProvider(provider)) {
    return apiError(c, 404, 'NOT_FOUND', '未対応の認証プロバイダです。');
  }
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    return apiError(c, 400, 'VALIDATION', '認証パラメータが不正です。');
  }

  // 手順2: state を KV から取得・削除（無ければ 400）
  const stateKey = `oauth:${state}`;
  const stateData = await c.env.KV.get<OAuthState>(stateKey, 'json');
  if (!stateData || stateData.provider !== provider) {
    return apiError(c, 400, 'VALIDATION', '認証セッションが無効です。もう一度お試しください。');
  }
  await c.env.KV.delete(stateKey);

  // 手順2〜3: code 交換 → id_token 検証
  const { id: clientId, secret: clientSecret } = clientCredentials(c.env, provider);
  let claims: ReturnType<typeof extractClaims>;
  try {
    const idToken = await exchangeCode(
      provider,
      code,
      clientId,
      clientSecret,
      redirectUri(c.env.APP_ORIGIN, provider),
    );
    const payload = await verifyIdToken(provider, idToken, clientId);
    claims = extractClaims(payload);
  } catch (e) {
    if (e instanceof OAuthError) {
      return apiError(c, 400, 'VALIDATION', '認証に失敗しました。もう一度お試しください。');
    }
    // jose の検証エラー（署名・aud・exp 不一致）も 400 として扱う
    return apiError(c, 400, 'VALIDATION', 'IDトークンの検証に失敗しました。');
  }

  if (!claims.sub) {
    return apiError(c, 400, 'VALIDATION', 'IDトークンの検証に失敗しました。');
  }

  // 手順3: email が取得できないアカウントはエラーページ
  if (!claims.email) {
    return c.html(
      '<!doctype html><html lang="ja"><meta charset="utf-8"><title>Memorix</title>' +
        '<p>このアカウントはメールアドレスを取得できないため利用できません。</p>' +
        '<p><a href="/login">ログインページへ戻る</a></p>',
      400,
    );
  }

  // 手順4: ユーザー解決（identity 検索 → email リンク → 新規作成 + 個人チーム）
  const user = await resolveUser(
    c.env.DB,
    provider,
    { ...claims, email: claims.email },
    c.env.ADMIN_EMAILS,
  );

  // 手順5: セッション発行 + Cookie
  const sessionId = await createSession(c.env.KV, user.id);
  c.header('Set-Cookie', sessionCookie(sessionId));

  // 手順6: redirectTo（保存値も再度サニタイズして防御）へ 302
  return c.redirect(sanitizeRedirectTo(stateData.redirectTo), 302);
});

// POST /api/auth/logout: KV削除 + Cookie失効（§5.1）
auth.post('/logout', async (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (sessionId) {
    await c.env.KV.delete(sessionKey(sessionId));
  }
  c.header('Set-Cookie', clearSessionCookie());
  return c.body(null, 204);
});

export default auth;
