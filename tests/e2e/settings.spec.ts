/**
 * 5 · Config: the UI language persists across a reload, text speed / auto-advance are saved, the
 * demo preset's "Test connection" works offline, and the relay toggle reflects both the player's
 * choice and whether the relay was detected.
 */
import { type Page } from '@playwright/test';
import { expect, test } from './support/test';
import { SETTINGS_KEY, expectScreen, openTitle, seedSettings } from './support/app';

async function storedSettings(page: Page): Promise<{ display: Record<string, unknown>; llm: Record<string, unknown> }> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').state.settings, SETTINGS_KEY);
}

async function openConfig(page: Page): Promise<void> {
  await page.getByTestId('title-config').click();
  await expectScreen(page, 'screen-SettingsScreen');
}

test('UI language, text speed and auto-advance persist across a reload', async ({ page }) => {
  await seedSettings(page, { display: { uiLang: 'zh' } });
  await openTitle(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await openConfig(page);
  await page.getByRole('tab', { name: /画面/ }).click();

  await page.getByTestId('display-lang').getByRole('radio', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Config' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Display/ })).toHaveAttribute('aria-selected', 'true');

  const speed = page.getByTestId('display-speed');
  await speed.focus();
  await speed.press('End');
  await expect(speed).toHaveAttribute('aria-valuetext', 'Instant');
  await page.getByTestId('display-auto').click();
  await expect(page.getByTestId('display-auto')).toHaveAttribute('aria-checked', 'true');
  expect((await storedSettings(page)).display).toMatchObject({ uiLang: 'en', textSpeed: 0, autoAdvance: true });

  // ── Reload: everything is still English and the choices are kept ──
  await openTitle(page, { reload: true });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('Interview Story · 面试物语');
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toContainText('New Interview');
  await openConfig(page);
  await page.getByRole('tab', { name: /Display/ }).click();
  await expect(page.getByTestId('display-lang').getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('display-speed')).toHaveAttribute('aria-valuetext', 'Instant');
  await expect(page.getByTestId('display-auto')).toHaveAttribute('aria-checked', 'true');

  // ── Back to Chinese from the title screen's 中 / EN switch ──
  await page.getByTestId('menu-back').click();
  await page.getByTestId('lang-switch').getByRole('radio', { name: '中' }).click();
  await expect(page.getByRole('navigation', { name: '主菜单' })).toContainText('开始面试');
  await openTitle(page, { reload: true });
  await expect(page.getByRole('navigation', { name: '主菜单' })).toContainText('开始面试');
});

test('demo preset: Test connection succeeds offline', async ({ page }) => {
  await seedSettings(page, { display: { uiLang: 'zh' } });
  await openTitle(page);
  await openConfig(page);
  await page.getByRole('tab', { name: /AI 模型/ }).click();
  await expect(page.getByTestId('llm-preset')).toHaveValue('demo');
  await expect(page.getByTestId('settings-llm')).toContainText('当前为演示模式');
  await page.getByTestId('llm-test').click();
  const result = page.getByTestId('llm-test-result');
  await expect(result).toContainText('连接成功！');
  await expect(result).toContainText('演示模式在本机离线运行');
});

test('relay toggle: on by default for a CORS-blocked preset, remembered when turned off', async ({ page }) => {
  await seedSettings(page, { display: { uiLang: 'zh' } });
  await openTitle(page);
  await openConfig(page);
  await page.getByRole('tab', { name: /AI 模型/ }).click();
  await page.getByTestId('llm-preset').selectOption('deepseek');
  const relay = page.getByTestId('llm-proxy');
  await expect(relay).toBeEnabled();
  await expect(relay).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('llm-base')).toHaveValue(/deepseek/);

  await relay.click();
  await expect(relay).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('这个服务商通常不允许浏览器直接调用')).toBeVisible();
  expect((await storedSettings(page)).llm).toMatchObject({ presetId: 'deepseek', useProxy: false });

  await openTitle(page, { reload: true });
  await openConfig(page);
  await expect(page.getByTestId('llm-proxy')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('llm-proxy').click();
  await expect(page.getByTestId('llm-proxy')).toHaveAttribute('aria-checked', 'true');
});

test('relay toggle is disabled with a hint when the relay is not available (static hosting)', async ({ page, consoleGuard }) => {
  consoleGuard.allow(/status of 404 \(Not Found\)/);
  await page.route('**/api/health', (route) => route.fulfill({ status: 404, body: 'Not found' }));
  await seedSettings(page, { display: { uiLang: 'zh' }, llm: { presetId: 'deepseek', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', useProxy: true } });
  await openTitle(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __stores: { settings: { getState(): { proxyAvailable: boolean | null } } } }).__stores.settings.getState().proxyAvailable)).toBe(false);
  await openConfig(page);
  const relay = page.getByTestId('llm-proxy');
  await expect(relay).toBeDisabled();
  await expect(relay).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('未检测到本地中转服务')).toBeVisible();
});
