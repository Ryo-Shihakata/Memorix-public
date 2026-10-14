import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        // wrangler.jsonc は assets（../web/dist）を含むため参照せず、
        // テストに必要なバインディングを直接定義する
        miniflare: {
          compatibilityDate: '2026-06-01',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['DB'],
          kvNamespaces: ['KV'],
          r2Buckets: ['IMAGES'],
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_ORIGIN: 'https://memorix.test',
            GOOGLE_CLIENT_ID: 'test-google-client-id',
            GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
            MS_CLIENT_ID: 'test-ms-client-id',
            MS_CLIENT_SECRET: 'test-ms-client-secret',
            ADMIN_EMAILS: 'admin@example.com, boss@example.com',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup.ts'],
    },
  };
});
