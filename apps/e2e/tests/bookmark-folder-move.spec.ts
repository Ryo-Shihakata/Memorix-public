import { expect, test } from '@playwright/test';
import { E2E_QUIZ_ID } from '../scripts/seed';
import { addSessionCookie } from './helpers/session';

// E2E③（依頼の完了条件）:
// ログイン済みユーザーがクイズをブックマークし、新規フォルダへ移動できる。
// E2E①用にシード済みの unlisted クイズ(E2E_QUIZ_ID)を流用する
// (GET /api/quiz-sets/:id は unlisted も所有者以外に返す仕様のため、ブックマーク対象として使える)。
test('ブックマークしたクイズをフォルダへ移動できる', async ({ page, context }) => {
  await addSessionCookie(context);

  await page.goto(`/quiz/${E2E_QUIZ_ID}`);
  await expect(page.getByRole('heading', { name: 'E2Eテストクイズ' })).toBeVisible();

  await page.getByRole('button', { name: '☆ ブックマーク' }).click();
  await expect(page.getByRole('button', { name: '★ ブックマーク済み' })).toBeVisible();

  await page.goto('/bookmarks');
  await expect(page.getByText('E2Eテストクイズ')).toBeVisible();

  const folderName = 'E2E移動先フォルダ';
  await page.getByPlaceholder('新しいフォルダ名').fill(folderName);
  await page.getByRole('button', { name: '追加' }).click();
  await expect(page.getByRole('button', { name: folderName, exact: true })).toBeVisible();

  await page.getByLabel('フォルダに移動').selectOption({ label: folderName });

  // 「すべて」表示のままだと移動後も見える。移動先フォルダを選ぶと絞り込まれて確認できる。
  await page.getByRole('button', { name: folderName, exact: true }).click();
  await expect(page.getByText('E2Eテストクイズ')).toBeVisible();

  await page.getByRole('button', { name: 'すべて', exact: true }).click();
  await expect(page.getByText('E2Eテストクイズ')).toBeVisible();
});
