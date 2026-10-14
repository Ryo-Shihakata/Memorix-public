import { applyD1Migrations, env, reset } from 'cloudflare:test';
import { beforeEach } from 'vitest';

// @cloudflare/vitest-pool-workers 0.18（vitest v4 対応版）はテストごとの
// 自動ストレージ分離を持たないため、各テスト前に全バインディングを
// リセットしてからマイグレーションを適用し直す。
beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
