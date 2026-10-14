// API のレスポンス型（camelCase）。DB は snake_case、Worker 側で変換する。
// v1 チャンク1では最小限のみ定義し、後続チャンクで各エンドポイントの実装に合わせて拡張する。

export type TeamRole = 'owner' | 'editor' | 'viewer';
export type ServiceRole = 'user' | 'admin';
export type QuizVisibility = 'public' | 'unlisted' | 'private';
export type QuestionType = 'text' | 'table';
export type CellType = 'text' | 'header' | 'blank' | 'image';
export type ImagePosition = 'above' | 'below';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: ServiceRole;
}

export interface Me {
  user: User;
  teams: Array<{
    id: string;
    name: string;
    role: TeamRole;
    isPersonal: boolean;
  }>;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  avatarImageId: string | null;
  isPersonal: boolean;
  storageUsedBytes: number;
  followerCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: TeamRole;
  createdAt: string;
}

export interface Subject {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  displayOrder: number;
  isActive: boolean;
}

export interface Folder {
  id: string;
  teamId: string;
  name: string;
  displayOrder: number;
}

// GET/POST /api/me/bookmark-folders（§7.1, §7.4）
export interface BookmarkFolder {
  id: string;
  name: string;
  displayOrder: number;
}

// 一覧用の要約。/api/discover, /api/teams/:id/profile 等で使用。
export interface QuizSetSummary {
  id: string;
  title: string;
  description: string | null;
  subject: Subject | null;
  teamName: string;
  playCount: number;
  questionCount: number;
  updatedAt: string;
}

// Studio でのフル構造（正解込み）。
export interface QuizSetDetail extends QuizSetSummary {
  teamId: string;
  folderId: string | null;
  visibility: QuizVisibility;
  shuffleQuestions: boolean;
  normalizeKana: boolean;
  timeLimitSecs: number | null;
  shareUrl: string | null;
}

// GET /api/teams/:id/profile（§7.2）
export interface TeamProfile {
  team: {
    id: string;
    name: string;
    description: string | null;
    avatarImageId: string | null;
  };
  followerCount: number;
  publicQuizzes: QuizSetSummary[];
}

export interface BlankDetail {
  id: string;
  blankOrder: number;
  acceptedAnswers: string[];
  hint: string | null;
  hintImageId: string | null;
}

export interface TableCellDetail {
  rowIndex: number;
  colIndex: number;
  cellType: CellType;
  content: string | null;
  imageId: string | null;
  blankOrder: number | null;
}

export interface QuestionDetail {
  id: string;
  type: QuestionType;
  title: string | null;
  displayOrder: number;
  textContent: string | null;
  imageId: string | null;
  imagePosition: ImagePosition;
  imageCaption: string | null;
  blanks: BlankDetail[];
  cells: TableCellDetail[] | null;
}

// GET .../quiz-sets/:id（Studio・正解込みフル構造）§7.6
export interface QuizSetFull extends QuizSetDetail {
  questions: QuestionDetail[];
}

// §8.1 プレイ用ペイロード。accepted_answers を含めないこと。
export interface PlayPayload {
  sessionId: string;
  quizSet: {
    id: string;
    title: string;
    description: string | null;
    teamName: string;
    normalizeKana: boolean;
    timeLimitSecs: number | null;
  };
  questions: Array<{
    id: string;
    type: QuestionType;
    title: string | null;
    textContent: string | null;
    image: { url: string; position: ImagePosition; caption: string | null } | null;
    cells: Array<{
      rowIndex: number;
      colIndex: number;
      cellType: CellType;
      content: string | null;
      imageUrl: string | null;
      blankId: string | null;
    }> | null;
    blanks: Array<{
      id: string;
      blankOrder: number;
      hint: string | null;
      hintImageUrl: string | null;
    }>;
  }>;
}

// §8.2 採点結果。
export interface SubmitResult {
  score: { correct: number; total: number; percent: number };
  results: Array<{
    blankId: string;
    userAnswer: string;
    isCorrect: boolean;
    correctAnswer: string;
  }>;
}

// §7.6 クイズ単位統計。詳細は stats チャンクで拡張。
export interface QuizStats {
  plays: number;
  completionRate: number;
  avgScorePercent: number;
  scoreHistogram: number[];
  dailyPlays: Array<{ date: string; count: number }>;
  blankStats: Array<{
    questionTitle: string | null;
    blankOrder: number;
    correctRate: number;
    attempts: number;
    topWrongAnswers: Array<{ answer: string; count: number }>;
  }>;
}

// §7.4/7.7 通報・モデレーション
export type ReportReason = 'inappropriate' | 'copyright' | 'spam' | 'other';
export type ReportStatus = 'open' | 'actioned' | 'dismissed';

export interface Report {
  id: string;
  quizSetId: string;
  quizTitle: string;
  teamName: string;
  reporterUserId: string | null;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  quizSuspendedAt: string | null;
}

// §7.7 admin ユーザー管理
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: ServiceRole;
  bannedAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

// GET /api/me/sessions・GET /api/me/sessions/:id（§7.1）
export interface MeSessionSummary {
  id: string;
  quizSetId: string;
  quizTitle: string;
  teamName: string;
  startedAt: string;
  submittedAt: string | null;
  score: { correct: number; total: number; percent: number } | null;
}

export interface MeSessionDetail extends MeSessionSummary {
  results: Array<{
    blankId: string;
    userAnswer: string;
    isCorrect: boolean;
    correctAnswer: string;
  }>;
}

// GET /api/me/stats（§7.1）
export interface MeStats {
  totalSessions: number;
  avgScore: number;
  recentScores: Array<{ quizTitle: string; percent: number; submittedAt: string }>;
  weakBlanks: Array<{
    questionTitle: string | null;
    blankOrder: number;
    correctRate: number;
  }>;
}

// GET /api/admin/stats/overview（§7.7）
export interface AdminStatsOverview {
  dau7: number;
  dau30: number;
  totalPlays: number;
  guestRatio: number;
  deviceRatio: { pc: number; mobile: number; tablet: number };
  topQuizzes: QuizSetSummary[];
}

export interface ApiError {
  error: {
    code:
      | 'UNAUTHORIZED'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'VALIDATION'
      | 'CONFLICT'
      | 'RATE_LIMITED'
      | 'QUOTA_EXCEEDED'
      | 'PAYLOAD_TOO_LARGE'
      | 'BANNED'
      | 'LAST_OWNER';
    message: string;
  };
}
