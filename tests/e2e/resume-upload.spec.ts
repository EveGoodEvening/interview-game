/**
 * 6 · Résumé upload through the real file input: DOCX (mammoth) and PDF (pdf.js worker) fixtures
 * end up in the editable preview; an unsupported file shows the localized error.
 */
import { fileURLToPath } from 'node:url';
import { type Page } from '@playwright/test';
import { expect, test } from './support/test';
import { FAST_SETTINGS, expectScreen, openTitle, seedSettings } from './support/app';

const fixture = (name: string) => fileURLToPath(new URL(`../../src/resume/__fixtures__/${name}`, import.meta.url));

async function openResumeStep(page: Page): Promise<void> {
  await page.getByTestId('title-new').click();
  await expectScreen(page, 'screen-SetupScreen');
  await page.getByTestId('setup-next').click();
  await expect(page.getByTestId('resume-drop')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await seedSettings(page, FAST_SETTINGS);
  await openTitle(page);
  await openResumeStep(page);
});

test('DOCX résumé is parsed into the preview', async ({ page }) => {
  await page.getByTestId('resume-file').setInputFiles(fixture('resume.docx'));
  const text = page.getByTestId('resume-text');
  await expect(text).toHaveValue(/李雷 Li Lei/);
  await expect(text).toHaveValue(/星河云科技 · 后端开发实习生/);
  await expect(text).toHaveValue(/- 负责订单服务重构，峰值 QPS 提升 3 倍/);
  await expect(text).toHaveValue(/Skills: Go, TypeScript/);
  await expect(page.getByText('已读取「resume.docx」')).toBeVisible();
  await expect(page.locator('.su-preview__head')).toContainText('resume.docx');
  await expect(page.getByTestId('resume-error')).toHaveCount(0);
  // The parsed résumé is good enough to move on.
  await page.getByTestId('setup-next').click();
  await expect(page.getByTestId('device-check')).toBeVisible();
});

test('PDF résumé (two-column, Chinese) is parsed in reading order', async ({ page }) => {
  await page.getByTestId('resume-file').setInputFiles(fixture('two-column-zh.pdf'));
  const text = page.getByTestId('resume-text');
  await expect(text).toHaveValue(/^林雨桐/);
  await expect(text).toHaveValue(/求职意向：Java 后端开发工程师/);
  await expect(text).toHaveValue(/负责订单状态机服务重构，状态不一致工单下降 90%。/);
  await expect(page.locator('.su-preview__head')).toContainText('two-column-zh.pdf · 1 页');

  // A second (Latin) PDF replaces the first.
  await page.getByTestId('resume-file').setInputFiles(fixture('simple.pdf'));
  await expect(text).toHaveValue(/^Jane Doe\nSoftware Engineer {2}jane@example\.com/);
  await expect(text).toHaveValue(/Cut latency by 40%/);
  await expect(page.locator('.su-preview__head')).toContainText('simple.pdf · 2 页');
});

test('an unsupported file shows a localized error and keeps the current résumé', async ({ page }) => {
  await page.getByTestId('resume-sample').click();
  const text = page.getByTestId('resume-text');
  const sample = await text.inputValue();
  expect(sample.length).toBeGreaterThan(200);

  await page.getByTestId('resume-file').setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
  });
  const error = page.getByTestId('resume-error');
  await expect(error).toContainText('读取失败');
  await expect(error).toContainText('暂不支持图片格式的简历');
  await expect(text).toHaveValue(sample);

  // English UI → English message.
  await page.evaluate(() =>
    (window as unknown as { __stores: { settings: { getState(): { update(p: unknown): void } } } }).__stores.settings
      .getState()
      .update({ display: { uiLang: 'en' } }),
  );
  await page.getByTestId('resume-file').setInputFiles({ name: 'resume.pages', mimeType: 'application/octet-stream', buffer: Buffer.from('PK\u0003\u0004 not really') });
  await expect(error).toContainText('Could not read the file');
  await expect(error).not.toContainText('暂不支持');
});
