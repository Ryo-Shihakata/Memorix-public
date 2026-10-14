import type { BrowserContext } from '@playwright/test';
import { E2E_SESSION_ID } from '../../scripts/seed';

// E2E②③用: OAuthをバイパスするため、シードスクリプト(scripts/seed.ts)がKVへ直接作成した
// セッションのCookieを注入する。
// NOTE(実装判断): CDP(Storage.setCookies)は __Host- プレフィックスのCookieに対して
// `url` フィールドを渡すと「Invalid cookie fields」で失敗する(確認済み)。
// `domain`+`path` を明示すると受理される（実機検証済み）ため、こちらを使う。
// localhost/127.0.0.1 はブラウザのSecure Context扱いのため、http でも Secure Cookie を送受信できる。
export async function addSessionCookie(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: '__Host-sess',
      value: E2E_SESSION_ID,
      domain: '127.0.0.1',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}
