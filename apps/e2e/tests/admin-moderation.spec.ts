import { expect, test } from '@playwright/test';
import { E2E_ADMIN_SESSION_ID, E2E_MOD_QUIZ_ID } from '../scripts/seed';

// playwright.config.ts の PORT(18787)に合わせた絶対URL。
// __Host- プレフィックスCookieはDomain属性を持てないため、addCookies には domain ではなく
// url を渡してホスト限定Cookieとして注入する（Playwrightの標準的な回避策）。
// また __Host- は secure: true が必須で、addCookies の Storage.setCookies は url のスキームで
// secure Cookie を検証するため url は https で渡す（実サーバーは http/127.0.0.1 だが、
// ChromiumはループバックIPをsecure contextとして扱うため実際のリクエストには問題なく付与される。
// 動作確認済み: /api/me が admin ユーザーで200を返すことを個別に検証した）。
const BASE_URL = 'https://127.0.0.1:18787';

// E2E④（依頼の完了条件）:
// ゲストが通報 → admin が対象クイズを suspend → 公開側(ゲスト)で当該クイズが404化することを確認する。
test('通報されたクイズをadminがsuspendすると公開側で404になる', async ({ page, browser }) => {
  // 1. ゲストがクイズ詳細ページから通報する
  await page.goto(`/quiz/${E2E_MOD_QUIZ_ID}`);
  await expect(page.getByRole('heading', { name: 'E2E通報対象クイズ' })).toBeVisible();

  await page.getByRole('button', { name: '通報する' }).click();
  // モーダルを開いた後は「通報する」ボタンが2つ存在する（背後のトリガーボタン＋モーダルの送信ボタン）。
  // モーダルの送信ボタンはDOM上で後に描画されるため .last() で特定する。
  await page.getByRole('button', { name: '通報する' }).last().click();
  await expect(page.getByText('通報を受け付けました。')).toBeVisible();

  // 2. admin セッションを別コンテキストへ注入し、通報キューを確認する
  const adminContext = await browser.newContext();
  await adminContext.addCookies([
    {
      name: '__Host-sess',
      value: E2E_ADMIN_SESSION_ID,
      url: BASE_URL,
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const adminPage = await adminContext.newPage();

  await adminPage.goto('/admin/reports');
  await expect(adminPage.getByRole('link', { name: 'E2E通報対象クイズ' })).toBeVisible();

  // 3. 対象クイズを停止する
  await adminPage.getByRole('button', { name: '停止する' }).click();
  const reasonInput = adminPage.getByLabel('E2E通報対象クイズの停止理由');
  await reasonInput.fill('E2Eテストによる停止');
  await adminPage.getByRole('button', { name: '停止を確定' }).click();
  await expect(adminPage.getByText('停止中')).toBeVisible();

  await adminContext.close();

  // 4. ゲスト側で再訪すると404（存在の有無を隠す）になる
  await page.reload();
  await expect(page.getByText('クイズが見つかりませんでした。')).toBeVisible();
});
