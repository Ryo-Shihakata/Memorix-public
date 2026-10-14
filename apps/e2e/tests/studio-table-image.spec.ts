import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { E2E_STUDIO_TEAM_ID } from '../scripts/seed';
import { addSessionCookie } from './helpers/session';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const TINY_PNG = path.resolve(dirname, 'fixtures/tiny.png');

// E2E②（依頼の完了条件）:
// ログイン済みの作成者が Studio で表型＋画像のクイズを作成し、限定公開の共有URLからプレイできる。
test('作成者が表型＋画像のクイズをStudioで作成しプレイできる', async ({ page, context }) => {
  await addSessionCookie(context);

  // クイズ作成
  await page.goto(`/studio/${E2E_STUDIO_TEAM_ID}/quizzes/new`);
  await page.getByPlaceholder('クイズタイトル').fill('E2E表クイズ');
  await page.getByRole('button', { name: '作成して続ける' }).click();
  // "/quizzes/new" 自体も `[^/]+` にマッチしてしまうため、生成される32桁hexのIDに限定して待つ。
  await page.waitForURL(/\/studio\/[^/]+\/quizzes\/[0-9a-f]{32}$/);
  const quizUrl = new URL(page.url());
  const quizId = quizUrl.pathname.split('/').pop() as string;

  // 問題編集画面へ
  await page.getByRole('link', { name: '問題を編集' }).click();
  await page.waitForURL(/\/questions$/);

  // 表問題を追加
  await page.getByRole('button', { name: '+ 表問題' }).click();

  // グリッドのセルは data-testid="studio-table-cell-{row}-{col}" で一意に特定する
  // (全角スペースでの空セル判定はPlaywrightの空白正規化で意図せず全ボタンにマッチしたため不採用)。
  const cell = (r: number, c: number) => page.getByTestId(`studio-table-cell-${r}-${c}`);

  // (0,0): 見出し「県」
  await cell(0, 0).click();
  await page.getByRole('button', { name: '見出し' }).click();
  await page.getByPlaceholder('セルの内容').fill('県');

  // (1,0): テキスト「東京都」
  await cell(1, 0).click();
  await page.getByPlaceholder('セルの内容').fill('東京都');

  // (0,1): 画像
  await cell(0, 1).click();
  await page.getByRole('button', { name: '画像', exact: true }).click();
  await page.getByRole('button', { name: '画像を選択' }).click();
  await page.locator('input[type="file"]').setInputFiles(TINY_PNG);
  await expect(page.getByText('[画像]')).toBeVisible();

  // (1,1): 空欄
  await cell(1, 1).click();
  await page.getByRole('button', { name: '空欄', exact: true }).click();
  await expect(page.getByText('空欄 1 として登録されています')).toBeVisible();

  // 空欄の正解候補を入力
  await page.getByPlaceholder('正解候補（改行区切り）').fill('答え1');

  // 保存
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('問題1・表型')).toBeVisible();

  // クイズ設定へ戻り、限定公開にして共有URLを発行
  await page.goto(`/studio/${E2E_STUDIO_TEAM_ID}/quizzes/${quizId}`);
  await page.getByRole('button', { name: '限定公開' }).click();
  await page.getByRole('button', { name: '共有URLを発行' }).click();
  const shareUrlInput = page.locator('input[readonly]');
  await expect(shareUrlInput).toHaveValue(/\/share\//);
  const shareUrl = await shareUrlInput.inputValue();
  // APP_ORIGIN はローカル開発では未設定のプレースホルダ値(wrangler.jsonc)のため URL としては不正な
  // ことがある。ここではトークン部分だけを文字列操作で取り出す。
  const shareToken = shareUrl.split('/share/').pop() as string;

  // ゲスト視点として共有URLからプレイ（同じブラウザコンテキストでも share は誰でも閲覧可）
  await page.goto(`/share/${shareToken}`);
  await page.getByRole('button', { name: 'はじめる' }).click();
  await page.waitForURL(/\/play\//);

  await expect(page.getByText('県')).toBeVisible();
  await expect(page.getByText('東京都')).toBeVisible();
  await expect(page.locator('img').first()).toBeVisible();

  const answerInput = page.getByPlaceholder('答え');
  await answerInput.click();
  await answerInput.fill('答え1');
  await page.getByRole('button', { name: '採点する' }).click();

  await page.waitForURL(/\/result\//);
  await expect(page.getByText('100%')).toBeVisible();
});
