import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import app from '../src/index';
import { newId } from '../src/lib/id';
import { createSession, sessionCookie } from '../src/lib/session';

export async function request(path: string, init?: RequestInit): Promise<Response> {
  const req = new Request(`https://memorix.test${path}`, init);
  const ctx = createExecutionContext();
  const res = await app.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export function jsonInit(method: string, body: unknown, cookie?: string): RequestInit {
  return {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  };
}

export interface SeededUser {
  id: string;
  cookie: string;
}

// users 行 + KV セッションを直接シードする（OAuth を経由しない）
export async function seedUser(role: 'user' | 'admin' = 'user'): Promise<SeededUser> {
  const id = newId();
  await env.DB.prepare('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)')
    .bind(id, `${id}@example.com`, 'Test User', role)
    .run();
  const sessionId = await createSession(env.KV, id);
  return { id, cookie: sessionCookie(sessionId).split(';')[0] ?? '' };
}

export async function seedTeam(options?: { personal?: boolean }): Promise<string> {
  const teamId = newId();
  await env.DB.prepare('INSERT INTO teams (id, name, is_personal) VALUES (?, ?, ?)')
    .bind(teamId, 'Seeded Team', options?.personal ? 1 : 0)
    .run();
  return teamId;
}

export async function addMember(
  teamId: string,
  userId: string,
  role: 'owner' | 'editor' | 'viewer',
): Promise<void> {
  await env.DB.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)')
    .bind(teamId, userId, role)
    .run();
}

export async function errorCode(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { code: string } };
  return body.error.code;
}
