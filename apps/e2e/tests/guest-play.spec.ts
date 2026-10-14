import { expect, test } from '@playwright/test';
import { E2E_CORRECT_ANSWER, E2E_SHARE_TOKEN } from '../scripts/seed';

// E2E①（依頼の完了条件）:
// APIでシードしたクイズ(テキスト型・unlisted)を、ゲストがshare URLからプレイ→採点結果を表示する。
test('ゲストが share URL からプレイして採点結果を確認できる', async ({ page }) => {
  await page.goto(`/share/${E2E_SHARE_TOKEN}`);

  await expect(page.getByRole('heading', { name: 'E2Eテストクイズ' })).toBeVisible();

  await page.getByRole('button', { name: 'はじめる' }).click();

  // /play/:sessionId へ遷移し、問題文と空欄入力が表示される
  await page.waitForURL(/\/play\//);
  await expect(page.getByText('日本の首都は')).toBeVisible();

  const answerInput = page.getByPlaceholder('答え');
  await answerInput.click();
  await answerInput.fill(E2E_CORRECT_ANSWER);

  await page.getByRole('button', { name: '採点する' }).click();

  // /result/:sessionId へ遷移し、正解として表示される
  await page.waitForURL(/\/result\//);
  await expect(page.getByText('100%')).toBeVisible();
  await expect(page.getByText('1 / 1 問正解')).toBeVisible();
});
