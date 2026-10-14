# Memorix 実装仕様書 v1.0（実装エージェント向け）

> 作成日: 2026-07-02
> 対応計画書: `memorix-plan-v3.md`
> 本書は実装エージェントが**追加の意思決定なしで**実装できることを目的とする。仕様が本書と矛盾する実装をしない。本書に無い細部（変数名・コンポーネント分割等）は各エージェントの裁量。

---

## 0. 原則

1. **正解データ（blanks.accepted_answers）を認可されていないクライアントに返すエンドポイントを作らない。** 返してよいのは所有チームのメンバー（editor以上… 閲覧はviewer可）と admin のみ。プレイ用ペイロードには絶対に含めない。
2. すべての書き込みAPIは Zod でバリデーションする（`@hono/zod-validator`）。
3. 権限チェックはリクエストごとに D1 を参照する。KV にキャッシュしない。
4. 日時は SQLite の `CURRENT_TIMESTAMP`（UTC）で統一。フロントで JST 表示に変換。
5. UI 文言は日本語。コード・識別子は英語。
6. 各フェーズ完了時に `pnpm typecheck && pnpm lint && pnpm test` を通し、証拠付きで報告する。

---

## 1. リポジトリ構成・ツールチェーン

- 場所: `C:\dev\projects\Chart-Quiz\`（リポジトリ名は `memorix` として git init）
- Node 22 / pnpm 9 / TypeScript 5.x strict

```
memorix/
├── apps/
│   ├── web/                    # React SPA（Vite）
│   │   ├── public/ (icons, manifest)
│   │   └── src/
│   │       ├── routes/         # ページ（§12 のルート表と1:1）
│   │       ├── components/     # quiz/ studio/ admin/ ui/(shadcn)
│   │       ├── hooks/
│   │       └── lib/            # apiクライアント, localStorage, 画像圧縮
│   └── worker/                 # Hono API + Static Assets 配信
│       ├── src/
│       │   ├── index.ts        # Hono ルート集約 + /img ハンドラ
│       │   ├── routes/         # auth.ts, discover.ts, play.ts, me.ts,
│       │   │                   # teams/(quizzes,questions,images,members,invites,folders,stats,csv),
│       │   │                   # admin/(subjects,reports,users,stats)
│       │   ├── middleware/     # session.ts, teamRole.ts, admin.ts, rateLimit.ts
│       │   └── lib/            # oauth.ts, grade.ts, csv.ts, r2.ts, id.ts
│       ├── migrations/         # 0001_init.sql, ...
│       └── wrangler.jsonc
├── packages/shared/src/        # types.ts, answerCheck.ts, limits.ts
├── templates/                  # CSVテンプレ3種 + README_csv_format.md
├── .github/workflows/          # deploy.yml, preview.yml
├── turbo.json / pnpm-workspace.yaml / biome.json / package.json
```

ルートの scripts: `dev`（wrangler dev + vite dev を turbo で並行）, `build`, `typecheck`, `lint`, `test`, `e2e`。

---

## 2. wrangler 設定・バインディング

`apps/worker/wrangler.jsonc`:

```jsonc
{
  "name": "memorix",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-01",
  "assets": {
    "directory": "../web/dist",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/img/*"]
  },
  "d1_databases": [{ "binding": "DB", "database_name": "memorix-db", "database_id": "<作成後に記入>" }],
  "kv_namespaces": [{ "binding": "KV", "id": "<作成後に記入>" }],
  "r2_buckets": [{ "binding": "IMAGES", "bucket_name": "memorix-images" }],
  "vars": { "APP_ORIGIN": "https://memorix.<account>.workers.dev" },
  "observability": { "enabled": true }
}
```

シークレット（`wrangler secret put`）:
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` / `ADMIN_EMAILS`（カンマ区切り。初回ログイン時に role=admin へ昇格）

KV キー設計:

| キー | 値 | TTL |
|------|----|----|
| `sess:{sessionId}` | `{"userId": "..."}` | 30日（アクセスごとに延長） |
| `oauth:{state}` | `{"provider":"google","redirectTo":"/"}` | 10分 |
| `rl:{bucket}:{key}:{windowStart}` | カウンタ数値 | ウィンドウ長×2 |

---

## 3. D1 スキーマ（migrations/0001_init.sql 完全版）

```sql
-- ユーザー・認証 --------------------------------------------------
CREATE TABLE users (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  avatar_url  TEXT,
  role        TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
  banned_at   DATETIME,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME
);

CREATE TABLE auth_identities (
  provider     TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
  provider_sub TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, provider_sub)
);

-- チーム ----------------------------------------------------------
CREATE TABLE teams (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name          TEXT NOT NULL,
  description   TEXT,
  avatar_image_id TEXT,                 -- images.id（FKなし: 循環回避）
  is_personal   INTEGER NOT NULL DEFAULT 0,
  storage_used_bytes INTEGER NOT NULL DEFAULT 0,
  follower_count INTEGER NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE team_members (
  team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE team_invites (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,       -- crypto.randomUUID() を2連結し '-' 除去
  role       TEXT NOT NULL CHECK(role IN ('editor','viewer')),
  expires_at DATETIME NOT NULL,
  max_uses   INTEGER,                    -- NULL=無制限
  use_count  INTEGER NOT NULL DEFAULT 0,
  revoked_at DATETIME,
  created_by TEXT REFERENCES users(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- カテゴリ・フォルダ ----------------------------------------------
CREATE TABLE subjects (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  slug          TEXT UNIQUE NOT NULL,    -- 例: 'english', 'math'
  name          TEXT NOT NULL,
  icon          TEXT,                    -- 絵文字
  color         TEXT,                    -- #hex
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE folders (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- クイズ ----------------------------------------------------------
CREATE TABLE quiz_sets (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  folder_id     TEXT REFERENCES folders(id) ON DELETE SET NULL,
  subject_id    TEXT REFERENCES subjects(id),
  title         TEXT NOT NULL,
  description   TEXT,
  visibility    TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('public','unlisted','private')),
  share_token   TEXT UNIQUE,
  shuffle_questions INTEGER NOT NULL DEFAULT 0,
  time_limit_secs INTEGER,               -- データモデルのみ。UI未実装
  normalize_kana INTEGER NOT NULL DEFAULT 0,
  play_count    INTEGER NOT NULL DEFAULT 0,  -- submit 成功時に +1
  suspended_at  DATETIME,                -- admin 強制非公開
  suspended_reason TEXT,
  created_by    TEXT REFERENCES users(id),
  published_at  DATETIME,                -- 初回 public/unlisted 化の時刻
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE questions (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  quiz_set_id    TEXT NOT NULL REFERENCES quiz_sets(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK(type IN ('text','table')),
  title          TEXT,
  display_order  INTEGER NOT NULL DEFAULT 0,
  text_content   TEXT,                   -- type='text': "[b:1]を…" マーカー入り
  image_id       TEXT REFERENCES images(id) ON DELETE SET NULL,
  image_position TEXT NOT NULL DEFAULT 'above' CHECK(image_position IN ('above','below')),
  image_caption  TEXT,
  import_key     TEXT,                   -- CSVのquestion_id（クイズ内一意、upsert用）
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE table_cells (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  row_index   INTEGER NOT NULL,
  col_index   INTEGER NOT NULL,
  cell_type   TEXT NOT NULL DEFAULT 'text' CHECK(cell_type IN ('text','header','blank','image')),
  content     TEXT,
  image_id    TEXT REFERENCES images(id) ON DELETE SET NULL,
  blank_id    TEXT REFERENCES blanks(id) ON DELETE SET NULL,  -- cell_type='blank' のとき必須（アプリ層で保証）
  UNIQUE(question_id, row_index, col_index)
);

CREATE TABLE blanks (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  question_id      TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  blank_order      INTEGER NOT NULL,     -- [b:N] の N。問題内で一意
  accepted_answers TEXT NOT NULL,        -- JSON配列文字列: ["東京","tokyo"]
  hint             TEXT,
  hint_image_id    TEXT REFERENCES images(id) ON DELETE SET NULL,
  UNIQUE(question_id, blank_order)
);

-- 画像 ------------------------------------------------------------
CREATE TABLE images (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  r2_key      TEXT NOT NULL UNIQUE,      -- teams/{team_id}/{image_id}.{ext}
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  file_size   INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  uploaded_by TEXT REFERENCES users(id),
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 受験 ------------------------------------------------------------
CREATE TABLE quiz_sessions (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  quiz_set_id    TEXT NOT NULL REFERENCES quiz_sets(id) ON DELETE CASCADE,
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,  -- NULL=ゲスト
  started_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at   DATETIME,
  total_blanks   INTEGER,
  correct_count  INTEGER,
  question_order TEXT NOT NULL,          -- JSON配列: question_id の出題順
  visibility_snapshot TEXT,              -- 開始時の visibility
  user_agent     TEXT,
  ip_country     TEXT                    -- request.cf.country
);

CREATE TABLE user_answers (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id        TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  blank_id          TEXT NOT NULL REFERENCES blanks(id) ON DELETE CASCADE,
  question_id       TEXT NOT NULL,
  user_answer       TEXT NOT NULL,
  is_correct        INTEGER NOT NULL,
  time_to_answer_ms INTEGER,
  answered_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ソーシャル ------------------------------------------------------
CREATE TABLE follows (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, team_id)
);

CREATE TABLE bookmark_folders (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bookmarks (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_set_id TEXT NOT NULL REFERENCES quiz_sets(id) ON DELETE CASCADE,
  folder_id   TEXT REFERENCES bookmark_folders(id) ON DELETE SET NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, quiz_set_id)
);

-- モデレーション --------------------------------------------------
CREATE TABLE reports (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  quiz_set_id      TEXT NOT NULL REFERENCES quiz_sets(id) ON DELETE CASCADE,
  reporter_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,  -- NULL=ゲスト
  reason           TEXT NOT NULL CHECK(reason IN ('inappropriate','copyright','spam','other')),
  detail           TEXT,                 -- 最大1000文字（アプリ層）
  status           TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','actioned','dismissed')),
  resolved_by      TEXT REFERENCES users(id),
  resolved_at      DATETIME,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- インデックス ----------------------------------------------------
CREATE INDEX idx_members_user ON team_members(user_id);
CREATE INDEX idx_invites_team ON team_invites(team_id);
CREATE INDEX idx_folders_team ON folders(team_id, display_order);
CREATE INDEX idx_quiz_team ON quiz_sets(team_id, updated_at);
CREATE INDEX idx_quiz_discover ON quiz_sets(visibility, subject_id, published_at);
CREATE INDEX idx_quiz_popular ON quiz_sets(visibility, subject_id, play_count);
CREATE INDEX idx_questions_set ON questions(quiz_set_id, display_order);
CREATE INDEX idx_cells_question ON table_cells(question_id, row_index, col_index);
CREATE INDEX idx_blanks_question ON blanks(question_id, blank_order);
CREATE INDEX idx_images_team ON images(team_id);
CREATE INDEX idx_sessions_set ON quiz_sessions(quiz_set_id, started_at);
CREATE INDEX idx_sessions_user ON quiz_sessions(user_id, started_at);
CREATE INDEX idx_answers_session ON user_answers(session_id);
CREATE INDEX idx_answers_blank ON user_answers(blank_id);
CREATE INDEX idx_bookmarks_user ON bookmarks(user_id, created_at);
CREATE INDEX idx_follows_team ON follows(team_id);
CREATE INDEX idx_reports_status ON reports(status, created_at);
```

注意: `table_cells.blank_id` の FK 先 `blanks` が後方定義になるため、**テーブル作成順は blanks を table_cells より先**に並べ替えて記述すること（上記は論理順。実 SQL ファイルでは blanks → table_cells の順）。

---

## 4. 共有パッケージ（packages/shared）

### 4.1 正規化・採点（answerCheck.ts — このまま実装）

```typescript
export interface NormalizationOptions { normalizeKana: boolean }

export function normalizeAnswer(str: string, opts: NormalizationOptions): string {
  // NFKC: 全角英数/記号→半角、半角ｶﾅ→全角カナ、㍑等の互換文字も吸収
  let s = str.normalize('NFKC').trim().toLowerCase();
  s = s.replace(/\s+/g, ' ');                    // 連続空白を1つに
  if (opts.normalizeKana) {
    s = s.replace(/[ァ-ヶ]/g, (c) =>     // カタカナ→ひらがな
      String.fromCharCode(c.charCodeAt(0) - 0x60));
  }
  return s;
}

export function checkAnswer(
  userAnswer: string, acceptedAnswers: string[], opts: NormalizationOptions
): boolean {
  const n = normalizeAnswer(userAnswer, opts);
  if (n === '') return false;
  return acceptedAnswers.some((a) => normalizeAnswer(a, opts) === n);
}
```

単体テスト必須ケース: `"Tokyo"` vs `"ＴＯＫＹＯ"`（一致）／`"とうきょう"` vs `"トウキョウ"`（normalizeKana=true のみ一致）／`"ﾄｳｷｮｳ"` vs `"トウキョウ"`（常に一致）／空文字（常に不正解）／前後・連続空白。

### 4.2 上限定数（limits.ts）

```typescript
export const LIMITS = {
  IMAGE_MAX_BYTES: 2 * 1024 * 1024,
  TEAM_STORAGE_MAX_BYTES: 200 * 1024 * 1024,
  QUIZ_SETS_PER_TEAM: 500,
  QUESTIONS_PER_QUIZ: 200,
  BLANKS_PER_QUESTION: 50,
  ANSWERS_PER_BLANK: 20,
  ANSWER_MAX_LEN: 200,
  TEXT_CONTENT_MAX_LEN: 10_000,
  TABLE_MAX_ROWS: 20,
  TABLE_MAX_COLS: 10,
  OWNED_TEAMS_PER_USER: 10,
  MEMBERS_PER_TEAM: 100,
  BOOKMARKS_PER_USER: 1000,
  BOOKMARK_FOLDERS_PER_USER: 50,
  TITLE_MAX_LEN: 120,
  DESCRIPTION_MAX_LEN: 2000,
  REPORT_DETAIL_MAX_LEN: 1000,
  SESSION_SUBMIT_WINDOW_HOURS: 24,
} as const;
```

### 4.3 型（types.ts）

API のレスポンス型を camelCase で定義（DB は snake_case、Worker 側で変換）。主要型: `Me`, `Team`, `TeamMember`, `Subject`, `Folder`, `QuizSetSummary`（一覧用: id/title/description/subject/teamName/playCount/questionCount/updatedAt）, `QuizSetDetail`, `PlayPayload`（§8）, `SubmitResult`（§8）, `QuizStats`（§7 admin/stats 参照）。

---

## 5. 認証仕様

### 5.1 OAuth（Google / Microsoft、Authorization Code Flow）

| | Google | Microsoft |
|---|---|---|
| authorize | `https://accounts.google.com/o/oauth2/v2/auth` | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` |
| token | `https://oauth2.googleapis.com/token` | `https://login.microsoftonline.com/common/oauth2/v2.0/token` |
| scope | `openid email profile` | `openid email profile` |
| JWKS | `https://www.googleapis.com/oauth2/v3/certs` | `https://login.microsoftonline.com/common/discovery/v2.0/keys` |

フロー:
1. `GET /api/auth/:provider?redirect_to=/path` → state 生成（randomUUID）、KV `oauth:{state}` に `{provider, redirectTo}` を TTL 600s で保存 → プロバイダへ 302。redirect_uri は `{APP_ORIGIN}/api/auth/{provider}/callback`。
2. callback で state を KV から取得・削除（無ければ 400）。code を token エンドポイントで交換。
3. `id_token` を jose で検証（署名 + aud=client_id + exp。**Microsoft は iss がテナントごとに変わるため iss 完全一致検証はしない**。aud と署名で担保）。claims から `sub` / `email` / `name` / `picture` を取得。email が無ければ `preferred_username` が email 形式なら採用、それも無ければエラーページへ（「このアカウントはメールアドレスを取得できないため利用できません」）。
4. ユーザー解決: `auth_identities(provider, sub)` で検索 → ヒットすればそのユーザー。無ければ email 一致の users を検索 → あれば identity を**リンク**、無ければ**新規作成**:
   - users INSERT（`ADMIN_EMAILS` に email が含まれれば role='admin'）
   - **個人チーム自動作成**: teams INSERT（name=ユーザー名, is_personal=1）+ team_members(owner)
5. セッション発行: `sessionId = 32byte ランダム hex`（`crypto.getRandomValues`）。KV `sess:{id}` TTL 30日。Cookie: `__Host-sess={id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`。
6. `redirectTo`（同一オリジンのパスのみ許可。`//` 始まりや `http` 始まりは `/` に置換）へ 302。

- `POST /api/auth/logout`: KV削除 + Cookie失効。
- `GET /api/me`: `{user, teams: [{id,name,role,isPersonal}]}` を返す。未ログインは 401。
- session ミドルウェア: Cookie → KV → users を引く。`banned_at` 非NULLなら KV セッション削除し 403 `BANNED`。KV TTL をアクセス時に再設定（スライディング）。

### 5.2 権限ミドルウェア

- `requireAuth`: 401 `UNAUTHORIZED`
- `requireTeamRole(minRole)`: パスの `:teamId` と現ユーザーで team_members を引き、`viewer < editor < owner` で比較。**service admin はすべてのチームで owner 相当**。不足は 403 `FORBIDDEN`
- `requireAdmin`: users.role='admin' 以外 403

---

## 6. 権限マトリクス（API 実装時の正）

| 操作 | ゲスト | user | team viewer | team editor | team owner | admin |
|------|:-:|:-:|:-:|:-:|:-:|:-:|
| public/unlisted クイズのプレイ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| private クイズのプレイ・閲覧 | — | — | ✅(所属チームのみ) | ✅ | ✅ | ✅ |
| 通報 | ✅(RL) | ✅ | ✅ | ✅ | ✅ | — |
| フォロー・ブックマーク・履歴 | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| チーム作成 | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| クイズ/フォルダ/画像 CRUD・公開切替・CSV | — | — | — | ✅ | ✅ | ✅ |
| 正解データ・統計の閲覧 | — | — | ✅ | ✅ | ✅ | ✅ |
| 招待発行・メンバー管理・チーム設定/削除 | — | — | — | — | ✅ | ✅ |
| 科目管理・通報対応・suspend・BAN | — | — | — | — | — | ✅ |

補足: 個人チーム（is_personal=1）は削除不可・owner の脱退不可。owner が最後の1人のとき降格・脱退不可（400 `LAST_OWNER`）。

---

## 7. API 仕様

共通規約:
- ベース: `/api`。認証は Cookie セッション。
- エラー: `{ "error": { "code": "...", "message": "日本語メッセージ" } }`。code は `UNAUTHORIZED` `FORBIDDEN` `NOT_FOUND` `VALIDATION` `CONFLICT` `RATE_LIMITED` `QUOTA_EXCEEDED` `PAYLOAD_TOO_LARGE` `BANNED` `LAST_OWNER`。
- 一覧は `?page=1&per_page=20`（max 100）で `{items, total, page, perPage}`。
- suspend 済みクイズは所有チームメンバーと admin 以外には一律 404。

### 7.1 認証・自分

```
GET  /api/auth/:provider            302（§5）
GET  /api/auth/:provider/callback   302
POST /api/auth/logout               204
GET  /api/me                        {user, teams}
GET  /api/me/sessions               受験履歴一覧（ページネーション）
GET  /api/me/sessions/:id           受験詳細（本人のみ）
GET  /api/me/stats                  {totalSessions, avgScore, recentScores[], weakBlanks[]}
GET  /api/me/feed                   フォロー中チームの public クイズ新着順
GET  /api/me/bookmarks?folder_id=   ブックマーク一覧
POST /api/me/bookmark-folders       {name} → 201
PATCH/DELETE /api/me/bookmark-folders/:id
```

### 7.2 発見・公開閲覧（認証不要）

```
GET /api/subjects                                  is_active=1 の科目一覧
GET /api/discover?subject=<slug>&sort=new|popular&q=&page=
    → public かつ非suspend の QuizSetSummary 一覧
    q はタイトル+説明の LIKE 部分一致（%・_ をエスケープ）。sort=new は published_at DESC、popular は play_count DESC
GET /api/quiz-sets/:id                              メタ情報のみ（public/unlisted。private は所属者のみ）
GET /api/share/:token                               share_token → 同メタ情報（RL: 30回/時/IP）
GET /api/teams/:id/profile                          {team, followerCount, publicQuizzes[]}
```

### 7.3 プレイ（§8 に詳細）

```
POST /api/sessions                 {quizSetId} または {shareToken}（RL: 60回/時/IP）
POST /api/sessions/:id/submit      回答一括提出 → 採点結果
GET  /api/sessions/:id/result      提出済みセッションの結果再取得
```

### 7.4 ソーシャル（要ログイン）

```
PUT    /api/teams/:id/follow        204（冪等）/ DELETE で解除。follower_count を増減
PUT    /api/quiz-sets/:id/bookmark  body {folderId?} 204（冪等・上書き）/ DELETE で解除
POST   /api/quiz-sets/:id/reports   {reason, detail?}（ゲスト可。RL: 5回/日/IP）→ 201
```

### 7.5 チーム管理（要ログイン）

```
POST   /api/teams                          {name, description?} → owner として作成
GET    /api/teams/:teamId                  メンバーなら詳細（storageUsedBytes 含む）
PATCH  /api/teams/:teamId                  owner。name/description/avatarImageId
DELETE /api/teams/:teamId                  owner。is_personal は 400
GET    /api/teams/:teamId/members          viewer 以上
PATCH  /api/teams/:teamId/members/:userId  owner。{role}（LAST_OWNER 検査）
DELETE /api/teams/:teamId/members/:userId  owner または本人（脱退）
POST   /api/teams/:teamId/invites          owner。{role, expiresInHours(≤720), maxUses?} → {url}
GET    /api/teams/:teamId/invites          owner。有効な招待一覧
DELETE /api/teams/:teamId/invites/:id      owner（失効）
POST   /api/invites/:token/accept          要ログイン。期限/回数/失効検査 → メンバー追加（既存なら 409）
GET    /api/invites/:token                 招待プレビュー {teamName, role}（未ログインでも可）
```

### 7.6 Studio: コンテンツ管理（editor 以上、パスは全て `/api/teams/:teamId/...`）

```
# フォルダ
GET/POST      .../folders               POST {name}
PATCH/DELETE  .../folders/:id           PATCH {name?, displayOrder?}

# クイズ
GET    .../quiz-sets?folder_id=&q=
POST   .../quiz-sets                    {title, description?, folderId?, subjectId?}
GET    .../quiz-sets/:id                正解込みフル構造（viewer も可）
PATCH  .../quiz-sets/:id                title/description/folderId/subjectId/shuffleQuestions/normalizeKana/timeLimitSecs
DELETE .../quiz-sets/:id
POST   .../quiz-sets/:id/duplicate      複製（visibility='private' で作成、画像は参照共有）
PATCH  .../quiz-sets/:id/visibility     {visibility}。public 化は subjectId 必須+質問1問以上、違反は 400
POST   .../quiz-sets/:id/share-token    トークン再生成 {shareUrl}。DELETE で無効化

# 問題
POST   .../quiz-sets/:id/questions      §7.6.1 の Question 入力
PATCH  .../questions/:id
DELETE .../questions/:id
PATCH  .../quiz-sets/:id/questions/reorder   {orderedIds: string[]}

# 空欄・セル
PUT    .../questions/:id/blanks         空欄全置換 [{blankOrder, acceptedAnswers[], hint?, hintImageId?}]
PUT    .../questions/:id/cells          セル全置換 [{rowIndex, colIndex, cellType, content?, imageId?, blankOrder?}]
```

> v1.1 改訂(2026-07-20): PUT blanks は textContent 同梱可、PUT cells は blanks 同梱可（原子的更新）。
> 理由: 相互検証により空欄集合の変更が2リクエストで表現不能だったため。

```
# 画像
POST   .../images                       multipart。§9 の検証 → {id, url, width, height}
GET    .../images                       ライブラリ一覧
DELETE .../images/:id                   参照中（questions/cells/blanks から）なら 409

# CSV
POST   .../quiz-sets/:id/import/preview multipart（最大3ファイル）→ 解析結果+警告（DB書込なし）
POST   .../quiz-sets/:id/import/confirm 同ファイル再送 → upsert 実行 {created, updated}
GET    .../quiz-sets/:id/export         zip（text_questions.csv / table_questions.csv / blanks.csv）

# 統計（viewer 以上）
GET    .../quiz-sets/:id/stats
  → {plays, completionRate, avgScorePercent, scoreHistogram: number[5],
     dailyPlays: [{date, count}]×30, blankStats: [{questionTitle, blankOrder,
     correctRate, attempts, topWrongAnswers: [{answer, count}]×5 }]}
```

#### 7.6.1 Question 入力スキーマ（Zod 論理定義）

```
{
  type: 'text' | 'table',
  title?: string(≤120),
  textContent?: string(≤10000),        // type='text' 必須
  imageId?: string, imagePosition?: 'above'|'below', imageCaption?: string,
  blanks: [{ blankOrder: int≥1, acceptedAnswers: string[1..20]（各≤200）,
             hint?: string, hintImageId?: string }],
  cells?: [{ rowIndex: 0..19, colIndex: 0..9,
             cellType: 'text'|'header'|'blank'|'image',
             content?: string, imageId?: string, blankOrder?: int }]  // type='table' 必須
}
```

サーバー側整合性検査（違反は 400 VALIDATION、日本語メッセージ）:
- text: `textContent` 内の `[b:N]` の集合 = blanks の blankOrder の集合（過不足・重複エラー）
- table: `cellType='blank'` のセル数 = blanks 数、各セルの blankOrder が blanks に存在
- imageId 系はすべて**同一チームの images** に存在すること

### 7.7 admin API（requireAdmin、プレフィックス `/api/admin`）

```
# 科目
GET/POST /subjects            POST {slug, name, icon?, color?}
PATCH/DELETE /subjects/:id    使用中の科目の DELETE は 409（is_active=0 を案内）

# 通報・モデレーション
GET   /reports?status=open
PATCH /reports/:id            {status: 'actioned'|'dismissed'}
POST  /quiz-sets/:id/suspend  {reason} → suspended_at/reason 設定。DELETE で解除
DELETE /quiz-sets/:id         完全削除

# ユーザー
GET   /users?q=
POST  /users/:id/ban          banned_at 設定（KVセッションは次アクセス時に無効化）
DELETE /users/:id/ban
PATCH /users/:id/role         {role: 'user'|'admin'}

# 統計
GET /stats/overview           {dau7, dau30, totalPlays, guestRatio,
                               deviceRatio: {pc, mobile, tablet},   // user_agent 判定
                               topQuizzes: QuizSetSummary[10]}
```

---

## 8. 採点・セッションライフサイクル

### 8.1 セッション開始 `POST /api/sessions`

入力: `{quizSetId}` または `{shareToken}`（どちらか必須）。
検査: クイズ存在・非suspend・アクセス権（public は誰でも / unlisted は token 必須 / private はチームメンバー）。
処理:
1. 出題順決定: `shuffle_questions=1` なら question_id をサーバーでシャッフル、それ以外は display_order 順。`question_order` に JSON 保存。
2. quiz_sessions INSERT（user_id はログイン時のみ、user_agent と `request.cf?.country` を記録、visibility_snapshot）。

レスポンス（**accepted_answers を含めないこと**）:

```typescript
interface PlayPayload {
  sessionId: string;
  quizSet: { id; title; description; teamName; normalizeKana: boolean; timeLimitSecs: number | null };
  questions: Array<{
    id; type: 'text' | 'table'; title: string | null;
    textContent: string | null;              // [b:N] マーカー入りのまま
    image: { url; position; caption } | null; // url = `/img/{image_id}`
    cells: Array<{ rowIndex; colIndex; cellType; content; imageUrl; blankId }> | null;
    blanks: Array<{ id; blankOrder; hint; hintImageUrl }>;
  }>;  // question_order の順で返す
}
```

### 8.2 提出 `POST /api/sessions/:id/submit`

入力: `{answers: [{blankId: string, answer: string(≤500), timeToAnswerMs?: int}]}`
検査: セッション存在／未提出（提出済みは 409 `CONFLICT`）／開始から24時間以内（超過 410 相当は 409 で `期限切れ` メッセージ）／blankId がこのクイズに属す。
処理（D1 batch で原子的に）:
1. クイズの全 blanks を取得。answers に無い blank は `userAnswer=''`・不正解として記録（未入力=不正解）。
2. `checkAnswer(answer, JSON.parse(accepted_answers), {normalizeKana})` で判定 → user_answers 一括 INSERT。
3. quiz_sessions UPDATE（submitted_at, total_blanks, correct_count）、quiz_sets.play_count +1。

レスポンス:

```typescript
interface SubmitResult {
  score: { correct: number; total: number; percent: number };
  results: Array<{ blankId: string; userAnswer: string; isCorrect: boolean;
                   correctAnswer: string /* accepted_answers[0] */ }>;
}
```

### 8.3 結果再取得 `GET /api/sessions/:id/result`

提出済みセッションの SubmitResult＋クイズメタを返す。認可: セッション ID（128bit ランダム）を知っていること自体を認可とみなす（ゲスト対応のため。結果には個人情報を含めない）。未提出は 404。

### 8.4 フロントの入力保護（v1 オフライン要件）

- キー `memorix:draft:{sessionId}` に `{answers: Record<blankId, string>, focusedAt: Record<blankId, number>}` を入力のたび debounce 500ms で保存。マウント時に復元。
- `time_to_answer_ms` = 各空欄の初回フォーカス時刻から最終入力時刻までの経過。
- 提出失敗（ネットワークエラー/5xx）時: draft を保持したまま「再送信」ボタン＋指数バックオフ自動リトライ（最大5回）。成功時に draft 削除。
- 将来のオフライン反復プレイ拡張は「PlayPayload のキャッシュ＋クライアント採点の練習モード」として実装する想定。v1 では作らないが、採点関数を shared に置くのはこのため。

---

## 9. 画像パイプライン

### クライアント（apps/web/src/lib/imageCompress.ts）

1. 入力 accept: `image/jpeg, image/png, image/webp, image/gif`
2. gif 以外: `createImageBitmap` → 長辺 2048px 超なら縮小 → canvas → `toBlob('image/webp', 0.85)`
3. gif: 無変換（2MB 超は「GIFは2MB以下にしてください」エラー）
4. 変換後も 2MB 超なら quality 0.7 で再試行 → それでも超過ならエラー表示

### サーバー `POST /api/teams/:teamId/images`

1. multipart の file とメタ（filename, width, height）を受領。Content-Length > 2MB は 413。
2. マジックバイト検証: WebP=`RIFF....WEBP` / PNG=`89 50 4E 47` / JPEG=`FF D8 FF` / GIF=`GIF8`。不一致は 400。**SVG・その他は拒否**。
3. クォータ: `storage_used_bytes + size > 200MB` なら 403 `QUOTA_EXCEEDED`。
4. `IMAGES.put('teams/{teamId}/{imageId}.{ext}', body, {httpMetadata: {contentType}})` → images INSERT → teams.storage_used_bytes += size（削除時は減算）。
5. RL: 60枚/日/チーム。

### 配信 `GET /img/:imageId`

images から r2_key を引き R2 から stream。ヘッダ: `Cache-Control: public, max-age=31536000, immutable`、`etag`。存在しない場合 404。（画像はイミュータブル運用: 差し替え=新規アップロード）

---

## 10. CSV 仕様

v2 形式から `set_id` / `set_title` 列を**削除**（インポート先クイズは URL で確定しているため）。文字コード UTF-8（BOM 許容）。`csv-parse` を使用。

**text_questions.csv**: `question_id, display_order, question_title, text_content, image_url`
**table_questions.csv**: `question_id, display_order, question_title, image_url, row, col, cell_type, content, is_blank`
**blanks.csv**: `question_id, blank_order, accepted_answers, hint`（accepted_answers はパイプ `|` 区切り）

- `question_id` は `questions.import_key` として保存し、再インポート時は**上書き更新**（既存の同 import_key の問題を子ごと削除→再作成）。
- image_url は `/img/{id}` 形式のみ受付（同一チームの画像であること）。それ以外の URL は警告してスキップ。
- preview は解析結果（問題数・空欄数・警告リスト: マーカー不整合、blanks.csv に無い空欄等）を返し、confirm で §7.6.1 と同じ整合性検査の上 upsert。
- エクスポートは同形式の zip。セル先頭が `= + - @` の場合 `'` を前置（CSVインジェクション対策）。テンプレ3種を `templates/` に同梱し、Studio からダウンロード可能にする。

---

## 11. レートリミット実装

KV 固定ウィンドウカウンタ: キー `rl:{bucket}:{key}:{floor(now/window)}`、初回 PUT 時に TTL=window×2。超過は 429。

| bucket | key | 上限 |
|--------|-----|------|
| `share` | IP | 30/時 |
| `session` | IP | 60/時 |
| `report` | IP | 5/日 |
| `upload` | teamId | 60/日 |
| `invite_accept` | IP | 20/時 |

IP は `CF-Connecting-IP` ヘッダ。KV は結果整合なので厳密性は求めない（防御目的で十分）。

---

## 12. フロントエンド仕様

### ルート表

| パス | 認証 | 内容 |
|------|:-:|------|
| `/` | — | 発見: 科目タブ＋新着/人気切替＋検索ボックス。ログイン時は上部に「フォロー新着」「マイチーム」「ブックマーク」セクション |
| `/search?q=` | — | 検索結果 |
| `/subjects/:slug` | — | 科目別一覧 |
| `/teams/:id` | — | チームプロフィール（公開クイズ・フォローボタン） |
| `/quiz/:id` | — | クイズ表紙（タイトル・説明・問題数・開始ボタン・ブックマーク・通報） |
| `/share/:token` | — | unlisted 表紙（内容は同上） |
| `/play/:sessionId` | — | 受験画面 |
| `/result/:sessionId` | — | 結果画面 |
| `/login` | — | Google / Microsoft ボタン |
| `/invites/:token` | ○ | 招待受諾（未ログインなら login へ、受諾後チームへ） |
| `/bookmarks` | ○ | ブックマーク（フォルダサイドバー＋ D&D で移動） |
| `/history` | ○ | 受験履歴・スコア推移・苦手空欄 |
| `/studio` | ○ | チーム切替（個人チームは「マイスペース」表示） |
| `/studio/:teamId` | ○ | クイズ一覧（フォルダツリー＋検索） |
| `/studio/:teamId/quizzes/new` `/quizzes/:id` | ○ | クイズ設定（visibility・科目・シャッフル・かな設定・共有URL） |
| `/studio/:teamId/quizzes/:id/questions` | ○ | 問題一覧（D&D 並び替え）＋エディタ（§12.2） |
| `/studio/:teamId/quizzes/:id/import` | ○ | CSV（プレビュー→確定） |
| `/studio/:teamId/quizzes/:id/stats` | ○ | 統計（§7.6 のデータをグラフ表示） |
| `/studio/:teamId/images` | ○ | 画像ライブラリ（使用量バー表示） |
| `/studio/:teamId/members` | ○ | メンバー・招待リンク管理（owner のみ操作可） |
| `/studio/:teamId/settings` | ○ | チーム設定 |
| `/admin` `/admin/subjects` `/admin/reports` `/admin/users` | admin | 運営コンソール |

### 12.1 受験画面

- text 型: `[b:N]` を正規表現 `/\[b:(\d+)\]/g` でインライン `<input>`（下線スタイル・枠なし・幅は placeholder 基準で auto-grow）に置換。
- table 型: header セルは背景色+太字、blank セルは `<input>`、image セルはクリックで lightbox。
- 問題画像は position に従い上下配置、クリックで lightbox、`alt` は caption または title。
- 下部固定バー: 入力済み空欄数 `n/total` ＋「採点する」ボタン。未入力ありの場合は confirm ダイアログ。
- 結果画面: スコア（%と分数）、問題ごとに ✅緑/❌赤 で userAnswer と模範解答を並記。「もう一度」（新セッション作成）ボタン。
- draft 自動保存・復元・提出リトライは §8.4。

### 12.2 Studio エディタ

- テキスト型: textarea で選択→「空欄にする」→ 未使用の最小 N で `[b:N]` 挿入し、下の空欄リストに行を自動追加（正解候補は改行区切り textarea、ヒント任意）。マーカー手書きも許容（blur 時に同期）。
- 表型: 行数×列数（初期 3×3）でグリッド生成。セルクリック → ポップオーバーで type 切替・内容編集。行列の追加/削除。blank にした瞬間、空欄リストに追加。
- 共通: プレビュー（受験画面コンポーネントを再利用・採点なし）、保存は §7.6 の API を使用。visibility='public' への切替時に科目未選択なら選択を促す。

### 12.3 実装規約

- API クライアント: `lib/api.ts` に fetch ラッパ（credentials: 'include'、エラー時 `error.code` で分岐、401 は login へ誘導）。TanStack Query でキャッシュ。mutation 成功時に該当 query を invalidate。
- グラフは Recharts（統計ページのみ動的 import）。
- shadcn/ui ベース。モバイルファースト（受験画面は 375px 幅を基準に設計）。

---

## 13. PWA

v2 計画の設定を継承し名称と URL を変更:

- manifest: name「Memorix」、short_name「Memorix」、theme_color `#4f46e5`、icons 192/512/maskable。
- vite-plugin-pwa `registerType: 'autoUpdate'`。runtimeCaching:
  - `/api/discover`・`/api/subjects` → NetworkFirst（timeout 5s）
  - `/img/` → CacheFirst（30日・最大200エントリ）
  - `/api/sessions` 系はキャッシュ**しない**

---

## 14. CI/CD（GitHub Actions）

**deploy.yml**（push: main）: ① test ジョブ（pnpm install → typecheck → lint → test → build）② migrate ジョブ（needs: test。`pnpm wrangler d1 migrations apply memorix-db --remote`）③ deploy ジョブ（needs: migrate。`pnpm wrangler deploy`、build 成果物を再利用）。
**preview.yml**（pull_request）: build → `pnpm wrangler versions upload` → 出力されたプレビュー URL を PR にコメント（`actions/github-script`）。
Secrets: `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`。

---

## 15. テスト・受け入れ基準

- **unit（Vitest）**: answerCheck 全ケース（§4.1）、CSV パーサ（正常・マーカー不整合・インジェクション）、権限比較関数、レートリミット計算。
- **integration（@cloudflare/vitest-pool-workers）**: 認証なしで正解が漏れないこと（PlayPayload に accepted_answers が無い）、権限マトリクス（§6 の全行×代表操作）、二重 submit 409、クォータ超過、invite の期限/回数/失効。
- **E2E（Playwright、ローカル wrangler dev に対して）**: ①作成者がテキスト型クイズを作り unlisted 公開 → ゲストが share URL からプレイ → 採点結果表示 ②表型＋画像 ③ブックマーク→フォルダ移動 ④通報→admin が suspend→404 化。
- 網羅率目標は設けない。上記シナリオが CI で緑であることをリリース条件とする。

---

## 16. 実装フェーズ（エージェント作業単位）

各チャンクは独立ブランチで実装 → verifier で検証 → main へ。**チャンク内の完了条件をすべて満たすまで次に進まない。**

| # | チャンク | 内容 | 完了条件 |
|---|---------|------|---------|
| 1 | scaffold | モノレポ / Biome / turbo / wrangler.jsonc / migration 0001 / shared（answerCheck+limits+テスト） / CI 雛形 | `pnpm typecheck && lint && test` 緑。`wrangler d1 migrations apply --local` 成功 |
| 2 | auth | OAuth 2種 / セッション / me / 個人チーム自動作成 / ADMIN_EMAILS / ban チェック | integration: 新規ログイン→users+teams+members 生成、email リンク、logout |
| 3 | teams | チーム CRUD / メンバー / 招待リンク / フォルダ / 権限ミドルウェア | §6 マトリクスのチーム行テスト緑、LAST_OWNER 検査 |
| 4 | quiz-crud | quiz_sets / questions / blanks / cells / 整合性検査 / 複製 / visibility / share-token | §7.6.1 の検査テスト、public 化条件 |
| 5 | play | sessions / submit / result / play_count / シャッフル / RL | 正解非漏洩テスト、二重 submit、24h 期限、ゲスト+ログイン両方 |
| 6 | images | アップロード検証 / クォータ / `/img/` 配信 / 削除時参照検査 | マジックバイト・413・QUOTA_EXCEEDED・配信キャッシュヘッダ |
| 7 | discover | subjects(admin CRUD 含む) / discover / 検索 / feed / follow / bookmark | LIKE エスケープ、フォロー数整合、ブックマーク上限 |
| 8 | stats | チーム統計 / me/stats / admin overview | §7.6 のレスポンス形と一致、日別30日集計 |
| 9 | csv | preview / confirm / export / テンプレ | upsert（再インポート上書き）、インジェクション対策 |
| 10 | moderation | reports / suspend / ban / admin users | suspend→非所有者 404、ban→セッション拒否 |
| 11 | fe-play | レイアウト / 発見 / 表紙 / 受験 / 結果 / 履歴 / ログイン / ブックマークUI | E2E ①（プレイ導線）緑 |
| 12 | fe-studio | Studio 一式（エディタ2種 / CSV / 画像 / メンバー / 統計グラフ） | E2E ②③ 緑 |
| 13 | fe-admin | admin コンソール / 通報フロー / 規約・プライバシーページ | E2E ④ 緑 |
| 14 | release | PWA / a11y（キーボード操作・aria） / エラー・ローディング UX / 本番シークレット / デプロイ | 本番 workers.dev で全 E2E 相当の手動確認、Lighthouse PWA 合格 |

---

## 17. カスタムドメイン移行手順（ドメイン確定後に実施）

1. ドメインを Cloudflare に追加（DNS 移管）。
2. Worker にカスタムドメイン `<domain>` を追加、`APP_ORIGIN` を更新。
3. Google / Microsoft の OAuth リダイレクト URI に `https://<domain>/api/auth/{provider}/callback` を追加。
4. （任意）R2 バケットに `images.<domain>` をバインドし、`/img/` 応答を 301 リダイレクトまたは URL 生成の切替で移行。
5. workers.dev ドメインは `wrangler.jsonc` で無効化（`workers_dev: false`）。

---

*実装仕様書 v1.0 以上。本書からの逸脱が必要になった場合は、実装せずまず本書の改訂を提案すること。*
