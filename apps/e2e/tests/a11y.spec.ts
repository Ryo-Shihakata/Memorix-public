import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { E2E_SHARE_TOKEN } from '../scripts/seed';

// 依頼(§16 チャンク14): axe-coreによる自動a11yチェック。主要ページで重大違反ゼロを確認する。
// 「重大違反」は axe の impact レベル 'critical' / 'serious' を指すものとし、
// 'moderate' / 'minor' はこのチェックの対象外とする（既存デザインへの過度な変更を避けるための裁量判断）。
test.describe('a11y (axe-core)', () => {
  test('トップページに重大な違反がない', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Memorix' })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    const critical = results.violations.filter((v) =>
      ['critical', 'serious'].includes(v.impact ?? ''),
    );
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });

  test('クイズ表紙(share)ページに重大な違反がない', async ({ page }) => {
    await page.goto(`/share/${E2E_SHARE_TOKEN}`);
    await expect(page.getByRole('heading', { name: 'E2Eテストクイズ' })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    const critical = results.violations.filter((v) =>
      ['critical', 'serious'].includes(v.impact ?? ''),
    );
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });
});
