import type { SessionUser } from '../env';
import { newId } from './id';
import type { OAuthClaims, Provider } from './oauth';

const USER_COLUMNS = 'id, email, name, avatar_url, role, banned_at';

function isAdminEmail(adminEmails: string, email: string): boolean {
  return adminEmails
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '')
    .includes(email);
}

// §5.1 手順4: auth_identities で検索 → email 一致でリンク → 無ければ新規作成（個人チーム自動作成）
export async function resolveUser(
  db: D1Database,
  provider: Provider,
  claims: OAuthClaims & { email: string },
  adminEmails: string,
): Promise<SessionUser> {
  // 1) provider + sub で既存 identity を検索
  const identity = await db
    .prepare('SELECT user_id FROM auth_identities WHERE provider = ? AND provider_sub = ?')
    .bind(provider, claims.sub)
    .first<{ user_id: string }>();

  if (identity) {
    const user = await db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
      .bind(identity.user_id)
      .first<SessionUser>();
    if (!user) {
      throw new Error('auth identity points to a missing user');
    }
    await db
      .prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(user.id)
      .run();
    return user;
  }

  // 2) email 一致の既存ユーザーがいれば identity をリンク
  const existing = await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`)
    .bind(claims.email)
    .first<SessionUser>();

  if (existing) {
    await db.batch([
      db
        .prepare('INSERT INTO auth_identities (provider, provider_sub, user_id) VALUES (?, ?, ?)')
        .bind(provider, claims.sub, existing.id),
      db
        .prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(existing.id),
    ]);
    return existing;
  }

  // 3) 新規作成: users + identity + 個人チーム（is_personal=1）+ owner メンバー
  const userId = newId();
  const teamId = newId();
  const role = isAdminEmail(adminEmails, claims.email) ? 'admin' : 'user';

  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, email, name, avatar_url, role, last_login_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(userId, claims.email, claims.name, claims.avatarUrl, role),
    db
      .prepare('INSERT INTO auth_identities (provider, provider_sub, user_id) VALUES (?, ?, ?)')
      .bind(provider, claims.sub, userId),
    db
      .prepare('INSERT INTO teams (id, name, is_personal) VALUES (?, ?, 1)')
      .bind(teamId, claims.name),
    db
      .prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner')")
      .bind(teamId, userId),
  ]);

  return {
    id: userId,
    email: claims.email,
    name: claims.name,
    avatar_url: claims.avatarUrl,
    role,
    banned_at: null,
  };
}
