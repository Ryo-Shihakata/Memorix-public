// E2E ①用のシードスクリプト。
// wrangler --local の D1（apps/worker/.wrangler/state）へ、テキスト型・unlisted のクイズを直接 INSERT する。
// 認証をバイパスできない制約のため（OAuth）、ゲストがシェアURLから解ける最小構成のみ用意する。
// 冪等性のため、既存の同IDレコードは一旦削除してから作り直す。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.resolve(dirname, '../../worker');

// blankId/quizSetId は API 側の Zod スキーマで length(32) が要求される
// （apps/worker/src/lib/sessionSchemas.ts）ため、DB のデフォルト ID 形式
// （lower(hex(randomblob(16)))）に合わせた固定の32桁16進文字列を使う。
export const E2E_SHARE_TOKEN = 'e2e-share-token-1';
export const E2E_TEAM_ID = 'e2e00000000000000000000000000001';
export const E2E_QUIZ_ID = 'e2e00000000000000000000000000002';
export const E2E_QUESTION_ID = 'e2e00000000000000000000000000003';
export const E2E_BLANK_ID = 'e2e00000000000000000000000000004';
export const E2E_CORRECT_ANSWER = '東京';

// E2E④（チャンク13 fe-admin）用の固定値。
// admin ログインは OAuth をバイパスできないため、D1 に role='admin' のユーザーを直接シードし、
// KV に対応するセッションを直接書き込んだ上で、テスト側で __Host-sess クッキーとして注入する。
export const E2E_ADMIN_USER_ID = 'e2eadmin'.padEnd(32, '0');
export const E2E_ADMIN_SESSION_ID = 'e2eadminsession'.padEnd(64, '0');
export const E2E_ADMIN_EMAIL = 'e2e-admin@example.com';
export const E2E_MOD_TEAM_ID = 'e2emod0000000000000000000000001';
export const E2E_MOD_QUIZ_ID = 'e2emod0000000000000000000000002';
export const E2E_MOD_QUESTION_ID = 'e2emod0000000000000000000000003';
export const E2E_MOD_BLANK_ID = 'e2emod0000000000000000000000004';

const sql = `
DELETE FROM quiz_sets WHERE id = '${E2E_QUIZ_ID}' OR share_token = '${E2E_SHARE_TOKEN}';
DELETE FROM teams WHERE id = '${E2E_TEAM_ID}';
INSERT INTO teams (id, name, is_personal) VALUES ('${E2E_TEAM_ID}', 'E2Eチーム', 0);
INSERT INTO quiz_sets (id, team_id, title, description, visibility, share_token, normalize_kana, shuffle_questions)
  VALUES ('${E2E_QUIZ_ID}', '${E2E_TEAM_ID}', 'E2Eテストクイズ', 'E2E用の説明', 'unlisted', '${E2E_SHARE_TOKEN}', 0, 0);
INSERT INTO questions (id, quiz_set_id, type, title, display_order, text_content)
  VALUES ('${E2E_QUESTION_ID}', '${E2E_QUIZ_ID}', 'text', '第1問', 0, '日本の首都は[b:1]である。');
INSERT INTO blanks (id, question_id, blank_order, accepted_answers, hint)
  VALUES ('${E2E_BLANK_ID}', '${E2E_QUESTION_ID}', 1, '["東京","tokyo"]', NULL);

DELETE FROM users WHERE id = '${E2E_ADMIN_USER_ID}' OR email = '${E2E_ADMIN_EMAIL}';
INSERT INTO users (id, email, name, role) VALUES ('${E2E_ADMIN_USER_ID}', '${E2E_ADMIN_EMAIL}', 'E2E管理者', 'admin');

DELETE FROM quiz_sets WHERE id = '${E2E_MOD_QUIZ_ID}';
DELETE FROM teams WHERE id = '${E2E_MOD_TEAM_ID}';
INSERT INTO teams (id, name, is_personal) VALUES ('${E2E_MOD_TEAM_ID}', 'E2Eモデレーション対象チーム', 0);
INSERT INTO quiz_sets (id, team_id, title, description, visibility, normalize_kana, shuffle_questions)
  VALUES ('${E2E_MOD_QUIZ_ID}', '${E2E_MOD_TEAM_ID}', 'E2E通報対象クイズ', 'モデレーションE2E用', 'public', 0, 0);
INSERT INTO questions (id, quiz_set_id, type, title, display_order, text_content)
  VALUES ('${E2E_MOD_QUESTION_ID}', '${E2E_MOD_QUIZ_ID}', 'text', '第1問', 0, '日本の首都は[b:1]である。');
INSERT INTO blanks (id, question_id, blank_order, accepted_answers, hint)
  VALUES ('${E2E_MOD_BLANK_ID}', '${E2E_MOD_QUESTION_ID}', 1, '["東京","tokyo"]', NULL);
`;

export function seedE2eDatabase(): void {
  execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', 'memorix-db', '--local', '--command', sql],
    { cwd: workerDir, stdio: 'inherit' },
  );
}

function kvPutSession(sessionId: string, userId: string): void {
  execFileSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'kv',
      'key',
      'put',
      `sess:${sessionId}`,
      JSON.stringify({ userId }),
      '--binding',
      'KV',
      '--local',
    ],
    { cwd: workerDir, stdio: 'inherit' },
  );
}

// KV に admin セッションを直接作成する（apps/worker/src/lib/session.ts の sessionKey/SessionData と同じ形状）。
export function seedAdminSession(): void {
  kvPutSession(E2E_ADMIN_SESSION_ID, E2E_ADMIN_USER_ID);
}

// E2E ②③用: Studio 側の操作(クイズ作成・画像アップロード・ブックマーク移動)にはログインが必要だが、
// OAuth はバイパスできないため、D1 に users/team_members を直接 INSERT した上で、
// KV に __Host-sess 用のセッションを直接作成する(依頼文に指定の方法)。
// テストコードは context.addCookies で E2E_SESSION_ID を __Host-sess Cookie として注入する。
export const E2E_USER_ID = 'e2e00000000000000000000000000005';
export const E2E_USER_EMAIL = 'e2e-user@example.com';
export const E2E_SESSION_ID = 'e2e0'.repeat(16); // 64桁hex（session.ts の randomHex(32) と同形式）
export const E2E_STUDIO_TEAM_ID = 'e2e00000000000000000000000000006';

const userSql = `
DELETE FROM team_members WHERE team_id = '${E2E_STUDIO_TEAM_ID}';
DELETE FROM teams WHERE id = '${E2E_STUDIO_TEAM_ID}';
DELETE FROM users WHERE id = '${E2E_USER_ID}';
INSERT INTO users (id, email, name, role) VALUES ('${E2E_USER_ID}', '${E2E_USER_EMAIL}', 'E2Eユーザー', 'user');
INSERT INTO teams (id, name, is_personal) VALUES ('${E2E_STUDIO_TEAM_ID}', 'E2E Studioチーム', 0);
INSERT INTO team_members (team_id, user_id, role) VALUES ('${E2E_STUDIO_TEAM_ID}', '${E2E_USER_ID}', 'owner');
`;

export function seedE2eUserAndSession(): void {
  execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', 'memorix-db', '--local', '--command', userSql],
    { cwd: workerDir, stdio: 'inherit' },
  );
  kvPutSession(E2E_SESSION_ID, E2E_USER_ID);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedE2eDatabase();
  seedAdminSession();
  seedE2eUserAndSession();
}
