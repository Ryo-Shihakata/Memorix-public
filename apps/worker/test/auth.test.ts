import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../src/index';

// ---- OAuth プロバイダのモック基盤 -------------------------------------
// 実プロバイダへは通信せず、globalThis.fetch をスタブして token/JWKS
// エンドポイントを差し替え、テスト用 RSA 鍵で署名した本物の JWT を
// jose に検証させる（署名・aud・exp の検証パスを実際に通す）。

let privateKey: CryptoKey;
let publicJwk: JWK;

interface StubRoute {
  method: string;
  url: string;
  body: string;
  headers: Record<string, string>;
}

let fetchStubs: StubRoute[] = [];

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = req.url.split('?')[0] ?? req.url;
    const index = fetchStubs.findIndex((s) => s.method === req.method && s.url === url);
    if (index === -1) {
      throw new Error(`unexpected outbound fetch: ${req.method} ${req.url}`);
    }
    const stub = fetchStubs.splice(index, 1)[0];
    if (!stub) throw new Error('unreachable');
    return new Response(stub.body, { status: 200, headers: stub.headers });
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  // 消費されなかったスタブが残っていないこと（想定外の分岐を検出）
  expect(fetchStubs).toHaveLength(0);
  fetchStubs = [];
});

type ProviderName = 'google' | 'microsoft';

const PROVIDER_MOCK: Record<
  ProviderName,
  { clientId: string; issuer: string; tokenUrl: string; jwksUrl: string }
> = {
  google: {
    clientId: 'test-google-client-id',
    issuer: 'https://accounts.google.com',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
  },
  microsoft: {
    clientId: 'test-ms-client-id',
    // MS は iss がテナントごとに変わる → 実装は iss を検証しない
    issuer: 'https://login.microsoftonline.com/some-tenant-id/v2.0',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    jwksUrl: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
  },
};

interface TokenClaims {
  sub: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  picture?: string;
}

async function signIdToken(provider: ProviderName, claims: TokenClaims): Promise<string> {
  const cfg = PROVIDER_MOCK[provider];
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject(claims.sub)
    .setIssuer(cfg.issuer)
    .setAudience(cfg.clientId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

function mockOAuthEndpoints(provider: ProviderName, idToken: string): void {
  const cfg = PROVIDER_MOCK[provider];
  const jsonHeaders = { 'content-type': 'application/json' };
  fetchStubs.push(
    {
      method: 'POST',
      url: cfg.tokenUrl,
      body: JSON.stringify({ id_token: idToken }),
      headers: jsonHeaders,
    },
    {
      method: 'GET',
      url: cfg.jwksUrl,
      body: JSON.stringify({ keys: [publicJwk] }),
      headers: jsonHeaders,
    },
  );
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const req = new Request(`https://memorix.test${path}`, init);
  const ctx = createExecutionContext();
  const res = await app.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

// callback を直接叩く（state は KV に直接シードする）
async function doCallback(
  provider: ProviderName,
  claims: TokenClaims,
  redirectTo = '/',
): Promise<Response> {
  const state = crypto.randomUUID();
  await env.KV.put(`oauth:${state}`, JSON.stringify({ provider, redirectTo }));
  mockOAuthEndpoints(provider, await signIdToken(provider, claims));
  return request(`/api/auth/${provider}/callback?code=test-code&state=${state}`);
}

function sessionCookieOf(res: Response): string {
  const setCookie = res.headers.get('set-cookie');
  expect(setCookie).toMatch(/^__Host-sess=[0-9a-f]{64};/);
  const first = setCookie?.split(';')[0];
  if (!first) throw new Error('no session cookie');
  return first;
}

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

// ---- テスト -----------------------------------------------------------

describe('GET /api/auth/:provider（開始）', () => {
  it('state を KV に保存しプロバイダへ 302 する', async () => {
    const res = await request('/api/auth/google?redirect_to=/studio');
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location') ?? '');
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc.searchParams.get('client_id')).toBe('test-google-client-id');
    expect(loc.searchParams.get('redirect_uri')).toBe(
      'https://memorix.test/api/auth/google/callback',
    );
    expect(loc.searchParams.get('scope')).toBe('openid email profile');

    const state = loc.searchParams.get('state') ?? '';
    const saved = await env.KV.get<{ provider: string; redirectTo: string }>(
      `oauth:${state}`,
      'json',
    );
    expect(saved).toEqual({ provider: 'google', redirectTo: '/studio' });
  });

  it('未対応プロバイダは 404', async () => {
    const res = await request('/api/auth/github');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('OAuth callback: 新規ログイン', () => {
  it('users + 個人チーム(is_personal=1) + owner メンバーが生成される', async () => {
    const res = await doCallback(
      'google',
      { sub: 'g-sub-1', email: 'alice@example.com', name: 'Alice', picture: 'https://p/a.png' },
      '/dashboard',
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/dashboard');
    const cookie = sessionCookieOf(res);

    expect(await count('users')).toBe(1);
    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
      .bind('alice@example.com')
      .first<{ id: string; role: string; name: string; last_login_at: string | null }>();
    expect(user).not.toBeNull();
    expect(user?.role).toBe('user');
    expect(user?.last_login_at).not.toBeNull();

    const team = await env.DB.prepare('SELECT * FROM teams').first<{
      id: string;
      name: string;
      is_personal: number;
    }>();
    expect(team?.is_personal).toBe(1);
    expect(team?.name).toBe('Alice');

    const member = await env.DB.prepare(
      'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
    )
      .bind(team?.id, user?.id)
      .first<{ role: string }>();
    expect(member?.role).toBe('owner');

    // /api/me がセッション Cookie で通る
    const meRes = await request('/api/me', { headers: { cookie } });
    expect(meRes.status).toBe(200);
    const me = (await meRes.json()) as {
      user: { email: string; role: string };
      teams: Array<{ role: string; isPersonal: boolean }>;
    };
    expect(me.user.email).toBe('alice@example.com');
    expect(me.teams).toHaveLength(1);
    expect(me.teams[0]).toMatchObject({ role: 'owner', isPersonal: true });
  });

  it('ADMIN_EMAILS に含まれる email は role=admin で作成される', async () => {
    const res = await doCallback('google', {
      sub: 'g-sub-admin',
      email: 'admin@example.com',
      name: 'Admin',
    });
    expect(res.status).toBe(302);
    const user = await env.DB.prepare('SELECT role FROM users WHERE email = ?')
      .bind('admin@example.com')
      .first<{ role: string }>();
    expect(user?.role).toBe('admin');
  });

  it('email が取得できないアカウントはエラーページ（400）', async () => {
    const res = await doCallback('google', { sub: 'g-sub-noemail', name: 'NoMail' });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain(
      'このアカウントはメールアドレスを取得できないため利用できません',
    );
    expect(await count('users')).toBe(0);
  });

  it('email 欠落時は preferred_username が email 形式なら採用する（Microsoft）', async () => {
    const res = await doCallback('microsoft', {
      sub: 'ms-sub-pu',
      preferred_username: 'bob@example.com',
      name: 'Bob',
    });
    expect(res.status).toBe(302);
    const user = await env.DB.prepare('SELECT email FROM users WHERE email = ?')
      .bind('bob@example.com')
      .first<{ email: string }>();
    expect(user?.email).toBe('bob@example.com');
  });
});

describe('OAuth callback: 既存ユーザーへのリンク', () => {
  it('同じ email の別 provider ログインで identity がリンクされ users は増えない', async () => {
    const first = await doCallback('google', {
      sub: 'g-sub-link',
      email: 'carol@example.com',
      name: 'Carol',
    });
    expect(first.status).toBe(302);
    expect(await count('users')).toBe(1);
    expect(await count('teams')).toBe(1);

    const second = await doCallback('microsoft', {
      sub: 'ms-sub-link',
      email: 'carol@example.com',
      name: 'Carol M',
    });
    expect(second.status).toBe(302);
    sessionCookieOf(second);

    expect(await count('users')).toBe(1);
    expect(await count('auth_identities')).toBe(2);
    expect(await count('teams')).toBe(1); // 個人チームは増えない

    const idents = await env.DB.prepare(
      'SELECT provider FROM auth_identities ORDER BY provider',
    ).all<{ provider: string }>();
    expect(idents.results.map((r) => r.provider)).toEqual(['google', 'microsoft']);
  });

  it('同一 identity での再ログインでは何も増えない', async () => {
    await doCallback('google', { sub: 'g-sub-re', email: 'dave@example.com', name: 'Dave' });
    await doCallback('google', { sub: 'g-sub-re', email: 'dave@example.com', name: 'Dave' });
    expect(await count('users')).toBe(1);
    expect(await count('auth_identities')).toBe(1);
    expect(await count('teams')).toBe(1);
  });
});

describe('OAuth callback: 異常系', () => {
  it('state が KV に無ければ 400', async () => {
    const res = await request('/api/auth/google/callback?code=x&state=unknown-state');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION');
  });

  it('redirectTo のオープンリダイレクトは / に置換される', async () => {
    for (const evil of ['//evil.example.com', 'https://evil.example.com', 'http://evil.com']) {
      const res = await doCallback(
        'google',
        { sub: `g-sub-${evil.length}`, email: `e${evil.length}@example.com`, name: 'Eve' },
        evil,
      );
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');
    }
  });
});

describe('セッション・logout・BAN', () => {
  async function login(email: string, sub: string): Promise<string> {
    const res = await doCallback('google', { sub, email, name: 'User' });
    expect(res.status).toBe(302);
    return sessionCookieOf(res);
  }

  it('未ログインの /api/me は 401', async () => {
    const res = await request('/api/me');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('logout でセッションが無効化され /api/me が 401 になる', async () => {
    const cookie = await login('frank@example.com', 'g-sub-frank');
    const sessionId = cookie.split('=')[1] ?? '';
    expect(await env.KV.get(`sess:${sessionId}`)).not.toBeNull();

    const logoutRes = await request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie },
    });
    expect(logoutRes.status).toBe(204);
    expect(logoutRes.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await env.KV.get(`sess:${sessionId}`)).toBeNull();

    const meRes = await request('/api/me', { headers: { cookie } });
    expect(meRes.status).toBe(401);
  });

  it('banned ユーザーのリクエストは 403 BANNED になりセッションが削除される', async () => {
    const cookie = await login('mallory@example.com', 'g-sub-mallory');
    const sessionId = cookie.split('=')[1] ?? '';
    await env.DB.prepare('UPDATE users SET banned_at = CURRENT_TIMESTAMP WHERE email = ?')
      .bind('mallory@example.com')
      .run();

    const res = await request('/api/me', { headers: { cookie } });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BANNED');
    expect(await env.KV.get(`sess:${sessionId}`)).toBeNull();
  });
});
