import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '../..');

const PORT = 18787;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // E2E①（§15）: wrangler dev(--local) を実サーバーとして起動する前に、シェルで直列に
  // 1) apps/web の本番ビルド（wrangler の assets binding が参照する dist/ を作る）
  // 2) D1 --local へマイグレーション適用
  // 3) テスト用クイズ（テキスト型・unlisted・share_token 固定）のシード
  // まで済ませてから wrangler dev を起動する。globalSetup と webServer の起動順に依存しないよう、
  // すべてこの1コマンドチェーンに閉じている。
  webServer: {
    command: [
      'pnpm --filter @memorix/web build',
      'pnpm --filter @memorix/worker exec wrangler d1 migrations apply memorix-db --local',
      'pnpm --filter @memorix/e2e run seed',
      `pnpm --filter @memorix/worker exec wrangler dev --port ${PORT}`,
    ].join(' && '),
    cwd: repoRoot,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
