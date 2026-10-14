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

-- 注意: blanks は table_cells より先に定義する（table_cells.blank_id が blanks を参照するため）
CREATE TABLE blanks (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  question_id      TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  blank_order      INTEGER NOT NULL,     -- [b:N] の N。問題内で一意
  accepted_answers TEXT NOT NULL,        -- JSON配列文字列: ["東京","tokyo"]
  hint             TEXT,
  hint_image_id    TEXT REFERENCES images(id) ON DELETE SET NULL,
  UNIQUE(question_id, blank_order)
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
