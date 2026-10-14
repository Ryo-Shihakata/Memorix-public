import type { D1Migration } from 'cloudflare:test';
import type { Env as WorkerEnv } from '../src/env';

// cloudflare:test の env は Cloudflare.Env 型。宣言マージで実バインディング型を与える。
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[]; // vitest.config.ts で定義
    }
  }
}
