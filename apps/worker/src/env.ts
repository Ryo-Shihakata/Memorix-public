export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  IMAGES: R2Bucket;
  APP_ORIGIN: string;
  // シークレット（wrangler secret put で設定）
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  MS_CLIENT_ID: string;
  MS_CLIENT_SECRET: string;
  ADMIN_EMAILS: string;
}

// session ミドルウェアが c.set('user', ...) するユーザー行（users テーブルの必要列）
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role: 'user' | 'admin';
  banned_at: string | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: SessionUser | null;
    sessionId: string | null;
  };
};
