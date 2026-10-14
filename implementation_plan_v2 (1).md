# 穴埋めクイズアプリ 実装計画書 v2.0

> 作成日: 2026-06-14  
> ステータス: ドラフト v2.0（v1からの変更・追加を統合）

---

## 変更サマリー（v1 → v2）

| 変更区分 | 内容 |
|---------|------|
| ✅ 追加 | 画像の問題への埋め込み（Cloudflare R2） |
| ✅ 追加 | 科目 → 範囲 → クイズ の3階層構造 |
| ✅ 追加 | editorロール（quizごとのアクセス制御） |
| ✅ 追加 | ランダム出題（必須） |
| ✅ 追加 | URLリンク共有（非公開リンク） |
| ✅ 追加 | 詳細統計システム |
| ✅ 追加 | 管理画面での手動問題作成UI |
| ✅ 更新 | 独自ドメイン前提 |
| ✅ 更新 | CSVは text型 / table型 を別ファイルに分割 |
| ✅ 更新 | プロジェクト単位でひらがな/カタカナ同一視を設定可能 |
| ✅ 更新 | 大文字小文字・半角全角は常に同一視（固定） |
| 🔲 拡張候補 | タイマー（データモデルのみ実装、UIは後回し） |

---

## 1. プロジェクト概要

プリント形式の穴埋めクイズをWeb / PWAで提供する学習支援アプリ。  
`科目 → 範囲 → クイズ` の階層でコンテンツを管理し、回答者はログイン不要でプレイできる。  
管理者はCSVインポートまたは管理UIで問題を作成・管理する。

### 確定要件

| 項目 | 内容 |
|------|------|
| クイズ形式 | テキスト虫食い・表の空欄・画像付き問題（混在可） |
| 正誤判定 | 大文字小文字・半角全角は**常に**同一視。ひらがな/カタカナはクイズセットごとに設定可 |
| 正解候補 | CSVまたはUIで複数正解候補を定義（パイプ区切り） |
| 一般ユーザー | ログイン不要でプレイ可能。ログイン（Google OAuth）すれば履歴保存 |
| ロール | `admin` / `editor` / `user` の3段階 |
| コンテンツ階層 | 科目 → 範囲 → クイズ |
| ランダム出題 | クイズセット単位で有効/無効を設定 |
| 共有 | パブリック / 非公開リンク（URLトークン） |
| 統計 | セッション・空欄・ユーザーレベルの詳細統計 |
| インフラ | Cloudflare完結（Pages / Workers / D1 / KV / R2） |
| デプロイ | 独自ドメイン + GitHub Actions |
| モバイル対応 | レスポンシブ + PWA |

---

## 2. 技術スタック

### フロントエンド（Cloudflare Pages）

```
React 19 + TypeScript
Vite 6 + vite-plugin-pwa
Tailwind CSS 4
shadcn/ui
React Router v7
TanStack Query v5
dnd-kit（ドラッグ&ドロップによる問題・選択肢の並び替え）
```

### バックエンド（Cloudflare Workers / Pages Functions）

```
Hono.js 4
@hono/zod-validator
Zod
jose（JWT生成・検証）
csv-parse（CSVパース、Workers対応）
```

### データストア

| Cloudflareサービス | 用途 |
|-----------------|------|
| **D1**（SQLite） | メインDB（問題・ユーザー・統計） |
| **KV** | セッション・OAuthのstateパラメータ |
| **R2** | 画像ファイル・一時CSVファイルの保存 |

### 開発ツール

```
pnpm workspaces（モノレポ）
Turborepo
Wrangler CLI
Biome（Lint/Format）
Vitest + Playwright（単体・E2Eテスト）
```

---

## 3. Cloudflare インフラ構成

```
独自ドメイン example.com
        │
        ├── Cloudflare DNS / Proxy
        │
        ├── *.example.com → Cloudflare Pages（React PWA）
        │     └── /functions/api/[[path]].ts
        │              │（Honoアプリをマウント）
        │              │
        │         ┌────▼──────────┐   ┌──────────────────┐
        │         │  Cloudflare   │   │  Cloudflare R2   │
        │         │  D1 (SQLite)  │   │  (Images / CSV)  │
        │         └───────────────┘   └──────────────────┘
        │              │
        │         ┌────▼──────────┐
        │         │  Cloudflare   │
        │         │  KV (Session) │
        │         └───────────────┘
        │
GitHub ─┤─── push to main ──→ GitHub Actions ──→ Cloudflare Pages Deploy
         └── PR ──→ Preview Deploy (*.pages.dev)
```

**R2 公開URL設定:**  
R2バケットにカスタムドメイン `images.example.com` をバインドし、画像を直接配信。

---

## 4. コンテンツ階層設計

```
科目（Subject）
  └── 範囲（Range）
        └── クイズセット（QuizSet）
              └── 問題（Question）
                    └── 空欄（Blank）
```

**例:**
```
科目: 中学2年国語
  └── 範囲: 第1章 文法の基礎
        ├── クイズ: 品詞の種類
        └── クイズ: 助詞・助動詞
  └── 範囲: 第2章 古文入門
        └── クイズ: 歴史的仮名遣い

科目: 中学2年数学
  └── 範囲: 連立方程式
        └── クイズ: 基本問題
```

---

## 5. ロール設計

### ロール定義

| ロール | できること |
|--------|----------|
| `admin` | 全機能。科目・範囲の作成。ユーザーのロール変更。editorのアサイン |
| `editor` | アサインされたクイズセットの編集 + **新規クイズセットの作成**（作成したものは自動的に自分がeditor） |
| `user` | クイズのプレイ・履歴閲覧（ログイン時） |

### editorのアクセス範囲

```
admin が editor を クイズセット単位でアサイン
  → そのeditorは対象クイズセットの
    ・問題・空欄の追加/編集/削除
    ・画像のアップロード
    ・公開/非公開の切り替え
    ・CSVインポート/エクスポート
    ができる（科目・範囲の操作は不可）

editor は新規クイズセットを作成できる
  → 作成した時点で自分がそのクイズのeditor（範囲はadminが指定 or 後で設定）
```

### 管理者ロールの指定

```
1. 環境変数 ADMIN_EMAILS: 初回ログイン時に自動でadminに昇格
2. 管理画面でadminが手動でロール変更
3. editorは管理画面でadminがアサイン
```

---

## 6. データベーススキーマ（Cloudflare D1）

```sql
-- ============================================================
-- ユーザー・認証
-- ============================================================

CREATE TABLE users (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  google_id   TEXT UNIQUE NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  avatar_url  TEXT,
  role        TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'editor', 'admin')),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login  DATETIME
);

-- ============================================================
-- コンテンツ階層
-- ============================================================

CREATE TABLE subjects (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name          TEXT NOT NULL,
  description   TEXT,
  icon          TEXT,             -- 絵文字 or iconify名
  color         TEXT,             -- テーマカラー (#hex)
  display_order INTEGER NOT NULL DEFAULT 0,
  is_published  INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT REFERENCES users(id),
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ranges (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  subject_id    TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT REFERENCES users(id),
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quiz_sets (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  range_id        TEXT NOT NULL REFERENCES ranges(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  is_published    INTEGER NOT NULL DEFAULT 0,
  -- 公開モード: 'public'(一覧表示) | 'unlisted'(URLのみ) | 'private'(非公開)
  visibility      TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('public','unlisted','private')),
  share_token     TEXT UNIQUE,    -- unlisted用のURLトークン
  shuffle_questions INTEGER NOT NULL DEFAULT 0,  -- 問題順をランダム
  shuffle_blanks  INTEGER NOT NULL DEFAULT 0,    -- 空欄の順番もランダム（将来拡張）
  time_limit_secs INTEGER,        -- NULL=制限なし（将来実装用）
  -- 正誤判定設定
  normalize_kana  INTEGER NOT NULL DEFAULT 0,    -- ひらがな↔カタカナ同一視
  -- 大文字小文字・半角全角は常に同一視（固定）
  created_by      TEXT REFERENCES users(id),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- editorのクイズセットへのアクセス権
CREATE TABLE quiz_editors (
  quiz_set_id TEXT NOT NULL REFERENCES quiz_sets(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by TEXT REFERENCES users(id),
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (quiz_set_id, user_id)
);

-- ============================================================
-- 画像管理（Cloudflare R2）
-- ============================================================

CREATE TABLE images (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  r2_key      TEXT NOT NULL UNIQUE,   -- R2のオブジェクトキー
  public_url  TEXT NOT NULL,          -- images.example.com/... の公開URL
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  file_size   INTEGER NOT NULL,       -- bytes
  width       INTEGER,                -- px
  height      INTEGER,                -- px
  uploaded_by TEXT REFERENCES users(id),
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 問題・空欄
-- ============================================================

CREATE TABLE questions (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  set_id         TEXT NOT NULL REFERENCES quiz_sets(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK(type IN ('text', 'table')),
  title          TEXT,
  display_order  INTEGER NOT NULL DEFAULT 0,
  -- type='text'のとき: "[b:1]を埋めてください。" のようにマーカーを埋め込む
  text_content   TEXT,
  -- 問題レベルの画像
  image_id       TEXT REFERENCES images(id),
  image_position TEXT DEFAULT 'above' CHECK(image_position IN ('above', 'below')),
  image_caption  TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 表型問題のセル定義
CREATE TABLE table_cells (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  row_index   INTEGER NOT NULL,
  col_index   INTEGER NOT NULL,
  -- cell_type: 'text'=通常 | 'header'=ヘッダー(太字背景) | 'blank'=空欄 | 'image'=画像
  cell_type   TEXT NOT NULL DEFAULT 'text' CHECK(cell_type IN ('text','header','blank','image')),
  content     TEXT,              -- テキストセルの内容
  image_id    TEXT REFERENCES images(id),  -- 画像セルの画像
  is_blank    INTEGER NOT NULL DEFAULT 0,
  blank_id    TEXT               -- blanksテーブルへの参照（is_blank=1のとき）
);

-- 空欄定義（テキスト型・テーブル型共通）
CREATE TABLE blanks (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  question_id      TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  blank_order      INTEGER NOT NULL,          -- 問題内での番号（[b:1],[b:2]...）
  accepted_answers TEXT NOT NULL,             -- JSON配列: ["東京","tokyo"]
  hint             TEXT,
  hint_image_id    TEXT REFERENCES images(id) -- ヒスト画像（任意）
);

-- ============================================================
-- 受験記録・統計
-- ============================================================

CREATE TABLE quiz_sessions (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  set_id         TEXT NOT NULL REFERENCES quiz_sets(id),
  user_id        TEXT REFERENCES users(id),   -- NULLはゲスト
  is_guest       INTEGER NOT NULL DEFAULT 1,
  started_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at   DATETIME,
  total_blanks   INTEGER,
  correct_count  INTEGER,
  -- クイズ設定のスナップショット（設定変更後も統計が壊れないように）
  question_order TEXT,           -- JSON配列: question_idの並び順
  user_agent     TEXT,           -- デバイス判別用
  ip_country     TEXT            -- Cloudflare CFヘッダーから
);

CREATE TABLE user_answers (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id       TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  blank_id         TEXT NOT NULL REFERENCES blanks(id),
  question_id      TEXT NOT NULL REFERENCES questions(id),
  user_answer      TEXT NOT NULL,
  is_correct       INTEGER NOT NULL,
  time_to_answer_ms INTEGER,     -- 入力開始から送信までのms（フロントで計測）
  answered_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- インデックス
-- ============================================================

CREATE INDEX idx_ranges_subject_id ON ranges(subject_id);
CREATE INDEX idx_quiz_sets_range_id ON quiz_sets(range_id);
CREATE INDEX idx_quiz_sets_share_token ON quiz_sets(share_token);
CREATE INDEX idx_questions_set_id ON questions(set_id, display_order);
CREATE INDEX idx_table_cells_question_id ON table_cells(question_id, row_index, col_index);
CREATE INDEX idx_blanks_question_id ON blanks(question_id);
CREATE INDEX idx_sessions_set_id ON quiz_sessions(set_id);
CREATE INDEX idx_sessions_user_id ON quiz_sessions(user_id);
CREATE INDEX idx_answers_session_id ON user_answers(session_id);
CREATE INDEX idx_answers_blank_id ON user_answers(blank_id);
CREATE INDEX idx_answers_question_id ON user_answers(question_id);
CREATE INDEX idx_quiz_editors_user_id ON quiz_editors(user_id);
```

---

## 7. CSV フォーマット仕様（v2）

### 7-1. テキスト虫食い型 (`text_questions.csv`)

`[b:N]` が空欄マーカー。N は blanks.csv の `blank_order` と対応。

```csv
set_id,set_title,question_id,display_order,question_title,text_content,image_url
S001,品詞テスト,Q001,1,助詞の種類,"「[b:1]」は主語を示す助詞。「[b:2]」は目的語を示す。",
S001,品詞テスト,Q002,2,,"日本の首都は[b:1]です。","https://images.example.com/japan_map.png"
```

`image_url` はR2の公開URLを直接書くか、空欄にして管理UIで後から設定できる。

### 7-2. 表型 (`table_questions.csv`)

```csv
set_id,set_title,question_id,display_order,question_title,image_url,row,col,cell_type,content,is_blank
S001,品詞テスト,Q003,3,品詞一覧,,0,0,header,品詞,0
S001,品詞テスト,Q003,3,品詞一覧,,0,1,header,意味,0
S001,品詞テスト,Q003,3,品詞一覧,,0,2,header,例,0
S001,品詞テスト,Q003,3,品詞一覧,,1,0,text,名詞,0
S001,品詞テスト,Q003,3,品詞一覧,,1,1,blank,[b:1],1
S001,品詞テスト,Q003,3,品詞一覧,,1,2,text,犬・山・愛,0
S001,品詞テスト,Q003,3,品詞一覧,,2,0,blank,[b:2],1
S001,品詞テスト,Q003,3,品詞一覧,,2,1,text,動きや状態を表す,0
S001,品詞テスト,Q003,3,品詞一覧,,2,2,text,走る・食べる,0
```

`cell_type` は `text` / `header` / `blank` / `image` の4種。

### 7-3. 正解定義 (`blanks.csv`) ※両タイプ共通

```csv
question_id,blank_order,accepted_answers,hint
Q001,1,は|ハ,読み方に注意
Q001,2,を|ヲ,
Q002,1,東京|とうきょう|tokyo|Tokyo,
Q003,1,物の名前を表す|ものの名前,
Q003,2,動詞|どうし,
```

### 7-4. インポート手順

管理画面から以下の2ファイルをセットでアップロード（同一の `set_id` が紐づく）:

```
① questions.csv（text_questionsまたはtable_questionsのどちらか、または両方を結合したもの）
② blanks.csv
```

- `question_id` が重複する場合は **上書き更新**
- インポート前に**プレビュー画面**でデータを確認してから確定できる
- インポート後にUIで個別編集可能

---

## 8. 正誤判定アルゴリズム（v2）

```typescript
// packages/shared/src/answerCheck.ts

export interface NormalizationOptions {
  normalizeKana: boolean;  // クイズセットのsetting
}

export function normalizeAnswer(str: string, opts: NormalizationOptions): string {
  let s = str
    .trim()
    .toLowerCase()
    .replace(/　/g, ' ')             // 全角スペース→半角
    // 全角英数→半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
    )
    // 全角記号・句読点の正規化
    .replace(/[！-～]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
    );

  if (opts.normalizeKana) {
    // カタカナ→ひらがなに統一
    s = s.replace(/[\u30A1-\u30F6]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0x60)
    );
  }

  return s;
}

export function checkAnswer(
  userAnswer: string,
  acceptedAnswers: string[],
  opts: NormalizationOptions
): boolean {
  const normalized = normalizeAnswer(userAnswer, opts);
  return acceptedAnswers.some(
    (ans) => normalizeAnswer(ans, opts) === normalized
  );
}
```

**常に正規化するもの（固定）:**
- 前後の空白（半角・全角）
- 大文字/小文字の統一
- 全角英数・記号 → 半角変換

**クイズセット単位で設定するもの:**
- ひらがな/カタカナの同一視（`normalize_kana`）

---

## 9. 画像サポート

### 画像を使える場所

| 場所 | 説明 |
|------|------|
| 問題の上部/下部 | 問題全体のコンテキスト画像 |
| テキスト型問題のキャプション | 問題文の後に補足画像 |
| 表型のセル | セルの内容を画像に置き換え（`cell_type='image'`） |
| 空欄のヒント | ヒントとして画像を表示 |

### R2 での画像管理

```
R2バケット構造:
quiz-images/
  ├── questions/
  │   └── {question_id}/{filename}
  ├── cells/
  │   └── {cell_id}/{filename}
  └── hints/
      └── {blank_id}/{filename}
```

- アップロード時に画像リサイズは**行わない**（Cloudflare Images は別途課金のため）
- フロントエンドで表示時にwidth/heightを指定してブラウザリサイズに委ねる
- 許可MIME: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`
- 最大サイズ: **10MB / ファイル**

### 画像アップロードフロー

```
[管理UI] → ファイル選択
         → POST /api/admin/images (multipart/form-data)
         → Workers が R2 にアップロード
         → images テーブルにメタデータ保存
         → 公開URL返却
         → UIがURLをフォームにセット
```

---

## 10. 統計システム

### 収集するデータ

```
quiz_sessions テーブル:
  - セッション開始時刻・完了時刻
  - ゲスト/ログインユーザー判別
  - デバイス（user_agentから判別）
  - 国（Cloudflare CF-IPCountryヘッダー）
  - 問題の出題順（shuffle時）

user_answers テーブル:
  - 空欄ごとの回答と正誤
  - 回答にかかった時間（ms）
  - 実際の回答テキスト
```

### 提供する統計ビュー

#### クイズセット統計（`/admin/quiz-sets/:id/stats`）

```
┌─────────────────────────────────────────────────┐
│  総プレイ数: 124       完了率: 78%               │
│  平均スコア: 68%       平均所要時間: 4分32秒     │
├─────────────────────────────────────────────────┤
│  スコア分布（ヒストグラム）                      │
│  0-20% ■■                                      │
│  20-40% ■■■■                                   │
│  40-60% ■■■■■■■                               │
│  60-80% ■■■■■■■■■■■                          │
│  80-100% ■■■■■■                               │
├─────────────────────────────────────────────────┤
│  日別プレイ数（過去30日 折れ線グラフ）           │
├─────────────────────────────────────────────────┤
│  空欄ごとの正解率（問題別ランキング）            │
│  1位 Q003-[b:2] 正解率 31% ← 最難              │
│  2位 Q001-[b:1] 正解率 45%                     │
│  ...                                             │
├─────────────────────────────────────────────────┤
│  最多誤答トップ5（各空欄の誤答テキスト集計）    │
└─────────────────────────────────────────────────┘
```

#### ダッシュボード全体統計（`/admin/dashboard`）

- 科目/範囲/クイズ別のプレイ数ランキング
- 直近7日・30日のアクティブユーザー数
- ゲスト vs ログインユーザーの比率
- デバイス比率（PC/スマートフォン/タブレット）

#### ユーザー別統計（`/admin/users/:id`）

- 受験したクイズ一覧・スコア推移
- 苦手な空欄（正解率の低い問題）

#### 自分の統計（`/history` ※ログインユーザー）

- 受験履歴一覧
- スコア推移グラフ
- 苦手問題の一覧

---

## 11. API エンドポイント設計

### 公開 API（認証不要）

```
# コンテンツ階層
GET  /api/subjects                         # 公開済み科目一覧
GET  /api/subjects/:id                     # 科目詳細 + 公開済み範囲一覧
GET  /api/ranges/:id                       # 範囲詳細 + 公開済みクイズ一覧

# クイズ取得
GET  /api/quiz-sets/:id                    # publicなクイズセット
GET  /api/quiz-sets/share/:token           # unlistedリンクアクセス

# 受験
POST /api/sessions                         # セッション開始
POST /api/sessions/:id/submit              # 全回答を一括送信
GET  /api/sessions/:id/result              # 結果取得
```

### 認証ユーザー API

```
GET  /api/me                               # ユーザー情報
GET  /api/me/sessions                      # 受験履歴（ページネーション付き）
GET  /api/me/sessions/:id                  # 受験詳細
GET  /api/me/stats                         # 自分の統計サマリー
```

### 認証 API

```
GET  /api/auth/google                      # OAuth開始
GET  /api/auth/callback                    # OAuthコールバック
POST /api/auth/logout                      # ログアウト
GET  /api/auth/me                          # セッション確認
```

### 管理者 API（`role: admin` のみ）

```
# 科目管理
GET    /api/admin/subjects
POST   /api/admin/subjects
PATCH  /api/admin/subjects/:id
DELETE /api/admin/subjects/:id
PATCH  /api/admin/subjects/:id/reorder     # 表示順変更

# 範囲管理
GET    /api/admin/subjects/:id/ranges
POST   /api/admin/subjects/:id/ranges
PATCH  /api/admin/ranges/:id
DELETE /api/admin/ranges/:id

# ユーザー管理
GET    /api/admin/users
PATCH  /api/admin/users/:id/role           # roleをadmin/editor/userに変更

# 統計
GET    /api/admin/stats/overview
GET    /api/admin/stats/quiz-sets/:id
GET    /api/admin/stats/users/:id
```

### クイズセット API（admin + そのクイズのeditor）

```
# クイズセット
GET    /api/admin/quiz-sets               # admin:全件, editor:自分のもの
POST   /api/admin/quiz-sets               # 新規作成（editorも可）
GET    /api/admin/quiz-sets/:id
PATCH  /api/admin/quiz-sets/:id           # 設定更新（normalization等）
DELETE /api/admin/quiz-sets/:id           # adminのみ
PATCH  /api/admin/quiz-sets/:id/publish   # 公開/非公開切り替え
POST   /api/admin/quiz-sets/:id/generate-token  # unlistedトークン生成

# editorアサイン（adminのみ）
GET    /api/admin/quiz-sets/:id/editors
POST   /api/admin/quiz-sets/:id/editors
DELETE /api/admin/quiz-sets/:id/editors/:userId

# 問題管理
GET    /api/admin/quiz-sets/:id/questions
POST   /api/admin/quiz-sets/:id/questions  # 手動作成
PATCH  /api/admin/questions/:id
DELETE /api/admin/questions/:id
PATCH  /api/admin/quiz-sets/:id/questions/reorder

# 空欄管理
GET    /api/admin/questions/:id/blanks
POST   /api/admin/questions/:id/blanks
PATCH  /api/admin/blanks/:id
DELETE /api/admin/blanks/:id

# テーブルセル管理
GET    /api/admin/questions/:id/cells
PUT    /api/admin/questions/:id/cells      # セル全体を一括更新

# CSV インポート / エクスポート
POST   /api/admin/import/preview           # インポートプレビュー（DBには保存しない）
POST   /api/admin/import/confirm           # インポート確定
GET    /api/admin/export/:setId            # クイズセットをCSVエクスポート

# 画像
POST   /api/admin/images                   # R2にアップロード
GET    /api/admin/images                   # 画像ライブラリ一覧
DELETE /api/admin/images/:id
GET    /api/admin/stats/quiz-sets/:id
```

---

## 12. フロントエンド ページ構成

### 一般ユーザー向け

| パス | コンテンツ |
|------|-----------|
| `/` | 科目一覧 |
| `/subjects/:id` | 科目詳細 + 範囲一覧 |
| `/ranges/:id` | 範囲詳細 + クイズ一覧 |
| `/quiz/:id` | クイズ受験画面 |
| `/share/:token` | 非公開リンクからの受験画面 |
| `/result/:sessionId` | 結果画面（スコア・正誤フィードバック） |
| `/history` | 受験履歴（ログイン必須） |

### 管理者・Editor向け（`/admin` 以下）

| パス | 対象ロール | コンテンツ |
|------|-----------|-----------|
| `/admin` | 全員 | ログインページ |
| `/admin/dashboard` | admin | 全体統計ダッシュボード |
| `/admin/subjects` | admin | 科目一覧管理 |
| `/admin/subjects/:id` | admin | 科目編集 + 範囲一覧 |
| `/admin/ranges/:id` | admin | 範囲編集 + クイズ一覧 |
| `/admin/quiz-sets` | editor | 自分のクイズ一覧 |
| `/admin/quiz-sets/new` | editor | 新規クイズ作成 |
| `/admin/quiz-sets/:id` | editor | クイズ設定編集 |
| `/admin/quiz-sets/:id/questions` | editor | 問題一覧・手動追加 |
| `/admin/quiz-sets/:id/import` | editor | CSVインポート（プレビュー→確定） |
| `/admin/quiz-sets/:id/stats` | editor | クイズ統計 |
| `/admin/quiz-sets/:id/editors` | admin | editorアサイン |
| `/admin/images` | editor | 画像ライブラリ |
| `/admin/users` | admin | ユーザー管理・ロール変更 |

---

## 13. 管理UI: 問題の手動作成フロー

### テキスト虫食い型の作成

```
① タイトルを入力（任意）
② 問題文テキストエリアに入力
   → 空欄にしたい部分を選択して「空欄にする」ボタン
   → [b:N] マーカーが自動挿入される
③ 画像を追加（任意）
   → ドラッグ&ドロップまたはファイル選択 → R2へアップロード
   → 画像位置（上/下）を選択
④ 各空欄の正解候補を入力（複数行で複数候補）
   → ヒントを入力（任意）
⑤ 保存（下書き保存も可）
```

### 表型の作成

```
① タイトルを入力（任意）
② 行数・列数を指定してテーブルを生成
③ 各セルをクリックして編集
   → テキスト入力 / ヘッダーに設定 / 空欄に設定 / 画像を設定
④ 行・列の追加/削除（ドラッグで並び替え）
⑤ 空欄に設定したセルの正解候補・ヒントを入力
⑥ 問題全体の画像を追加（任意）
⑦ 保存
```

### 共通機能

- **プレビューボタン**: 回答者が見る画面をそのまま確認できる
- **下書き保存**: 公開せずに保存
- **複製**: 既存問題をコピーして新規作成

---

## 14. クイズ受験 UI の仕様

### テキスト虫食い型の表示

```
問題文の例:
「[b:1]」は主語を示す助詞です。「[b:2]」は目的語を示します。

↓ 表示

「 [____] 」は主語を示す助詞です。「 [____] 」は目的語を示します。
```

- `[b:N]` をインライン `<input>` に置換
- 入力中は文章に溶け込むスタイル（下線のみ、枠なし）
- モバイルではInputをtap → キーボード表示

### 表型の表示

- 通常セル: テキストまたは画像をそのまま表示
- ヘッダーセル: 背景色付きで太字
- 空欄セル: セル内に `<input>` を配置、セル幅に合わせる
- 画像セル: 画像を表示（クリックで拡大）

### 問題に付属する画像

- テキスト/表の上下に表示
- タップ/クリックで拡大表示（lightbox）
- alt属性必須（アクセシビリティ）

### ランダム出題時の動作

- `shuffle_questions=1` の場合、クイズセット取得時にサーバー側でシャッフル
- セッション開始時に出題順を確定し `quiz_sessions.question_order` に保存
- 途中再開時も同じ順番で表示できる

### 回答後フィードバック

- ✅ 正解: 緑 + 正解テキストを表示
- ❌ 不正解: 赤 + ユーザーの回答 + 模範解答（`accepted_answers[0]`）を表示
- スコア: `{正解数} / {全空欄数}` + パーセンテージ
- 空欄ごとに `time_to_answer_ms` を記録（フロントで入力フォーカス時刻を基準に計測）

---

## 15. 共有機能

| モード | 設定 | 動作 |
|--------|------|------|
| `public` | is_published=1, visibility='public' | 科目・範囲のページ一覧に表示。誰でもアクセス可 |
| `unlisted` | is_published=1, visibility='unlisted' | 一覧には表示されない。`/share/{token}` のURLを持つ人のみアクセス可 |
| `private` | visibility='private' | 管理者・editorのみアクセス可（下書き扱い） |

**unlisted URLの例:**
```
https://example.com/share/xK7mNp3qR2
```

- `share_token` は `POST /api/admin/quiz-sets/:id/generate-token` で生成
- 既存トークンの無効化 + 新規発行も可能（再生成）
- セッション統計にはvisibilityのスナップショットも記録（public/unlisted）

---

## 16. PWA 設定（v2）

```json
// public/manifest.json
{
  "name": "穴埋めクイズ",
  "short_name": "穴埋め",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#4f46e5",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "screenshots": [
    { "src": "/screenshots/quiz-mobile.png", "sizes": "390x844", "type": "image/png", "form_factor": "narrow" }
  ]
}
```

```typescript
// Service Worker（vite-plugin-pwa）
VitePWA({
  registerType: 'autoUpdate',
  workbox: {
    runtimeCaching: [
      {
        urlPattern: /\/api\/quiz-sets\/.+/,
        handler: 'NetworkFirst',
        options: { cacheName: 'quiz-data', networkTimeoutSeconds: 5 }
      },
      {
        urlPattern: /\/api\/subjects/,
        handler: 'NetworkFirst',
        options: { cacheName: 'subject-list', networkTimeoutSeconds: 5 }
      },
      {
        // R2画像はキャッシュ優先
        urlPattern: /^https:\/\/images\.example\.com\//,
        handler: 'CacheFirst',
        options: {
          cacheName: 'quiz-images',
          expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 } // 30日
        }
      }
    ]
  }
})
```

---

## 17. ディレクトリ構成（更新版）

```
quiz-app/
├── apps/
│   ├── web/                          # Cloudflare Pages (React PWA)
│   │   ├── public/
│   │   │   ├── icons/
│   │   │   ├── screenshots/
│   │   │   └── manifest.json
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── quiz/
│   │   │   │   │   ├── TextBlank.tsx        # 虫食い文
│   │   │   │   │   ├── TableBlank.tsx       # 表の空欄
│   │   │   │   │   ├── BlankInput.tsx       # 共通入力欄
│   │   │   │   │   ├── QuizImage.tsx        # 画像表示 + lightbox
│   │   │   │   │   └── ResultCard.tsx       # 結果表示
│   │   │   │   ├── admin/
│   │   │   │   │   ├── TextQuestionEditor.tsx  # テキスト型問題エディタ
│   │   │   │   │   ├── TableBuilder.tsx        # 表型問題エディタ
│   │   │   │   │   ├── CsvImporter.tsx         # CSVインポート
│   │   │   │   │   ├── ImageUploader.tsx        # 画像アップロード
│   │   │   │   │   ├── ImageLibrary.tsx         # 画像ライブラリ
│   │   │   │   │   ├── QuizSettings.tsx         # クイズ設定（normalize等）
│   │   │   │   │   ├── StatsChart.tsx           # 統計グラフ
│   │   │   │   │   └── EditorAssigner.tsx       # editorアサイン
│   │   │   │   └── ui/                          # shadcn/uiコンポーネント
│   │   │   ├── pages/
│   │   │   │   ├── Home.tsx                 # 科目一覧
│   │   │   │   ├── Subject.tsx              # 科目詳細
│   │   │   │   ├── Range.tsx                # 範囲詳細
│   │   │   │   ├── Quiz.tsx                 # クイズ受験
│   │   │   │   ├── Share.tsx                # 非公開リンクアクセス
│   │   │   │   ├── Result.tsx               # 結果
│   │   │   │   ├── History.tsx              # 受験履歴
│   │   │   │   └── admin/
│   │   │   │       ├── Dashboard.tsx
│   │   │   │       ├── Subjects.tsx
│   │   │   │       ├── SubjectEdit.tsx
│   │   │   │       ├── RangeEdit.tsx
│   │   │   │       ├── QuizSets.tsx
│   │   │   │       ├── QuizSetEdit.tsx
│   │   │   │       ├── QuestionList.tsx
│   │   │   │       ├── QuestionEdit.tsx
│   │   │   │       ├── CsvImport.tsx
│   │   │   │       ├── Stats.tsx
│   │   │   │       ├── ImageLibrary.tsx
│   │   │   │       └── Users.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useAuth.ts
│   │   │   │   ├── useQuiz.ts
│   │   │   │   └── useStats.ts
│   │   │   └── lib/
│   │   │       ├── api.ts
│   │   │       └── timer.ts              # 回答時間計測
│   │   └── functions/
│   │       └── api/[[path]].ts           # HonoをPages Functionsにマウント
│   │
│   └── api/                              # Honoアプリ本体
│       └── src/
│           ├── index.ts
│           ├── routes/
│           │   ├── auth.ts
│           │   ├── subjects.ts
│           │   ├── ranges.ts
│           │   ├── quiz.ts
│           │   ├── sessions.ts
│           │   └── admin/
│           │       ├── subjects.ts
│           │       ├── ranges.ts
│           │       ├── quiz-sets.ts
│           │       ├── questions.ts
│           │       ├── blanks.ts
│           │       ├── cells.ts
│           │       ├── images.ts
│           │       ├── import.ts
│           │       ├── stats.ts
│           │       └── users.ts
│           ├── middleware/
│           │   ├── auth.ts
│           │   ├── editor.ts         # editorロール + クイズアクセス権チェック
│           │   └── admin.ts
│           ├── db/
│           │   ├── schema.sql
│           │   └── migrations/
│           └── lib/
│               ├── answerCheck.ts
│               ├── csvParser.ts
│               ├── csvExporter.ts
│               └── r2.ts             # R2操作ヘルパー
│
├── packages/
│   └── shared/
│       └── src/
│           ├── types.ts
│           ├── answerCheck.ts        # 判定ロジック（共有）
│           └── constants.ts
│
├── templates/
│   ├── text_questions_template.csv
│   ├── table_questions_template.csv
│   ├── blanks_template.csv
│   └── README_csv_format.md
│
├── .github/
│   └── workflows/
│       ├── deploy.yml
│       └── preview.yml
│
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## 18. CI/CD（GitHub Actions）

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm run typecheck
      - run: pnpm run lint
      - run: pnpm run test

  migrate:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - name: Run D1 migrations
        run: pnpm wrangler d1 migrations apply quiz-db --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

  deploy:
    needs: migrate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm run build

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: quiz-app
          directory: apps/web/dist

# .github/workflows/preview.yml
name: Preview Deploy

on:
  pull_request:

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm run build
      - uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: quiz-app
          directory: apps/web/dist
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
          # PRに自動でプレビューURLをコメント
```

---

## 19. 環境変数・シークレット

### Cloudflare Workers シークレット

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_REDIRECT_URI      # https://example.com/api/auth/callback
wrangler secret put JWT_SECRET               # openssl rand -hex 32
wrangler secret put ADMIN_EMAILS             # admin@example.com,other@example.com
```

### wrangler.toml バインディング

```toml
name = "quiz-app-api"
compatibility_date = "2024-09-23"
main = "src/index.ts"

[[d1_databases]]
binding = "DB"
database_name = "quiz-db"
database_id = "..."

[[kv_namespaces]]
binding = "SESSIONS"
id = "..."

[[r2_buckets]]
binding = "IMAGES"
bucket_name = "quiz-images"

[vars]
R2_PUBLIC_URL = "https://images.example.com"
```

### GitHub Actions シークレット

```
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

---

## 20. 実装フェーズ（更新版）

### Phase 1 — 基盤構築（2週間）

- [ ] モノレポ・CI/CDパイプライン
- [ ] Cloudflare D1スキーマ・マイグレーション
- [ ] Google OAuth（admin/editorのみでテスト）
- [ ] 科目・範囲・クイズセットのCRUD API
- [ ] 独自ドメイン + R2のカスタムドメイン設定

### Phase 2 — クイズのコア機能（3週間）

- [ ] 問題・空欄のCRUD API（テキスト型・表型）
- [ ] CSVインポート・プレビュー・確定フロー
- [ ] CSVエクスポート
- [ ] 正誤判定ロジック（shared package）
- [ ] セッション・回答APIと統計記録
- [ ] ランダム出題（セッション開始時にシャッフル）

### Phase 3 — 画像・共有（1.5週間）

- [ ] R2画像アップロードAPI
- [ ] 問題・セルへの画像紐付け
- [ ] unlistedリンク共有（share_token生成・検証）
- [ ] editorアサインAPI

### Phase 4 — フロントエンドUI（3〜4週間）

- [ ] 科目→範囲→クイズ階層ナビゲーション
- [ ] テキスト虫食い・表型受験画面
- [ ] 画像表示・lightbox
- [ ] 結果フィードバック画面
- [ ] 受験履歴ページ
- [ ] 管理ダッシュボード（全体統計）
- [ ] テキスト型問題エディタ（[b:N]ヘルパー付き）
- [ ] 表型ビルダーUI
- [ ] 画像ライブラリ・アップロードUI
- [ ] CSVインポートUI（プレビュー画面含む）
- [ ] クイズ統計ページ（グラフ）
- [ ] ユーザー管理・editorアサイン画面

### Phase 5 — PWA・品質（1週間）

- [ ] PWA設定（manifest / Service Worker）
- [ ] オフライン対応（受験キャッシュ）
- [ ] レスポンシブ最終確認（実機）
- [ ] アクセシビリティ（aria属性・キーボード操作）
- [ ] エラー・ローディングUXの整備

### Phase 6 — リリース準備（数日）

- [ ] 本番シークレット設定
- [ ] 管理者初期アカウント設定
- [ ] E2Eテスト（Playwright）
- [ ] 管理者向けマニュアル作成

---

## 21. Cloudflare 料金試算（v2）

| サービス | 無料枠 | 追加課金ライン | 小中規模想定 |
|---------|-------|-------------|------------|
| **Pages** | 500ビルド/月・帯域無制限 | - | ¥0 |
| **Workers** | 10万リクエスト/日 | $5/月〜 | ¥0〜 |
| **D1** | 5GB・500万row読取/月 | $0.75/GB〜 | ¥0 |
| **KV** | 10万読取/日 | $0.50/百万〜 | ¥0 |
| **R2** | 10GB・クラスA100万/月 | $0.015/GB〜 | **要注意** |
| **カスタムドメイン** | 無料（DNS管理をCloudflareに移管） | - | ¥0 |

**R2について:** 画像を大量にアップロードする場合は費用が発生する。  
- 画像1枚平均500KB × 1,000問 = 約500MB → 無料枠内
- 画像1,000枚を超えるようであれば費用を見積もること

---

## 22. セキュリティ考慮点（v2追加分）

- **R2アクセス制御**: 管理API経由でのみアップロード可能。直接R2へのPUTは不可
- **画像の種別チェック**: MIMEタイプとファイルマジックバイト（先頭バイト）の両方で検証
- **CSVインジェクション**: セルの先頭が `=` `+` `-` `@` の場合は先頭にシングルクォートを付与
- **editorアクセス制御**: `quiz_editors` テーブルの参照はMiddlewareで毎回D1から検証（KVキャッシュは使わない）
- **share_token**: `crypto.randomUUID()` を使用。総当たり攻撃対策としてレートリミット（KV）を設ける
- **統計データのプライバシー**: ゲストの `user_agent` はUIには表示しない（デバイス種別に集計のみ）

---

*v2計画書 以上。Phase 1から着手し、Phase 2終了時点で内部αテストを推奨します。*
