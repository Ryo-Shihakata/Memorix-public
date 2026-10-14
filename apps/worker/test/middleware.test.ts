import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/env';
import { newId } from '../src/lib/id';
import { createSession, sessionCookie } from '../src/lib/session';
import { requireAdmin, requireTeamRole, sessionMiddleware } from '../src/middleware/session';

// requireTeamRole / requireAdmin の単体挙動を、実 D1 + KV を使った最小アプリで検証する。
// （本格的な利用はチャンク3以降だが、ミドルウェア自体はここで実装・検証しておく）

const testApp = new Hono<AppEnv>();
testApp.use('*', sessionMiddleware);
testApp.get('/teams/:teamId/viewer-only', requireTeamRole('viewer'), (c) => c.json({ ok: true }));
testApp.get('/teams/:teamId/editor-only', requireTeamRole('editor'), (c) => c.json({ ok: true }));
testApp.get('/teams/:teamId/owner-only', requireTeamRole('owner'), (c) => c.json({ ok: true }));
testApp.get('/admin-only', requireAdmin, (c) => c.json({ ok: true }));

async function seedUser(role: 'user' | 'admin' = 'user'): Promise<{ id: string; cookie: string }> {
  const id = newId();
  await env.DB.prepare('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)')
    .bind(id, `${id}@example.com`, 'Test User', role)
    .run();
  const sessionId = await createSession(env.KV, id);
  return { id, cookie: sessionCookie(sessionId).split(';')[0] ?? '' };
}

async function seedTeam(userId: string, role: 'owner' | 'editor' | 'viewer'): Promise<string> {
  const teamId = newId();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO teams (id, name) VALUES (?, ?)').bind(teamId, 'Team'),
    env.DB.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').bind(
      teamId,
      userId,
      role,
    ),
  ]);
  return teamId;
}

async function get(path: string, cookie?: string): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await testApp.fetch(
    new Request(`https://memorix.test${path}`, { headers: cookie ? { cookie } : {} }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe('requireTeamRole', () => {
  it('未ログインは 401', async () => {
    const res = await get(`/teams/${newId()}/viewer-only`);
    expect(res.status).toBe(401);
  });

  it('viewer は viewer-only に通り editor-only は 403', async () => {
    const { id, cookie } = await seedUser();
    const teamId = await seedTeam(id, 'viewer');
    expect((await get(`/teams/${teamId}/viewer-only`, cookie)).status).toBe(200);
    expect((await get(`/teams/${teamId}/editor-only`, cookie)).status).toBe(403);
    expect((await get(`/teams/${teamId}/owner-only`, cookie)).status).toBe(403);
  });

  it('editor は editor-only まで通り owner-only は 403', async () => {
    const { id, cookie } = await seedUser();
    const teamId = await seedTeam(id, 'editor');
    expect((await get(`/teams/${teamId}/viewer-only`, cookie)).status).toBe(200);
    expect((await get(`/teams/${teamId}/editor-only`, cookie)).status).toBe(200);
    expect((await get(`/teams/${teamId}/owner-only`, cookie)).status).toBe(403);
  });

  it('owner はすべて通る', async () => {
    const { id, cookie } = await seedUser();
    const teamId = await seedTeam(id, 'owner');
    expect((await get(`/teams/${teamId}/owner-only`, cookie)).status).toBe(200);
  });

  it('非メンバーは 403', async () => {
    const { cookie } = await seedUser();
    const { id: otherId } = await seedUser();
    const teamId = await seedTeam(otherId, 'owner');
    expect((await get(`/teams/${teamId}/viewer-only`, cookie)).status).toBe(403);
  });

  it('service admin は非メンバーでも owner 相当で通る', async () => {
    const { cookie } = await seedUser('admin');
    const { id: otherId } = await seedUser();
    const teamId = await seedTeam(otherId, 'owner');
    expect((await get(`/teams/${teamId}/owner-only`, cookie)).status).toBe(200);
  });
});

describe('requireAdmin', () => {
  it('未ログインは 401、user は 403、admin は 200', async () => {
    expect((await get('/admin-only')).status).toBe(401);
    const { cookie: userCookie } = await seedUser('user');
    expect((await get('/admin-only', userCookie)).status).toBe(403);
    const { cookie: adminCookie } = await seedUser('admin');
    expect((await get('/admin-only', adminCookie)).status).toBe(200);
  });
});
