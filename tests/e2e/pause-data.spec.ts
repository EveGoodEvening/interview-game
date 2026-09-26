/**
 * 7 · The pause model and Config → Data.
 *
 * - Pausing (Esc menu) while the mic records stops the take: what was heard becomes an editable
 *   draft and is NOT auto-submitted, even with auto-submit on. The answer clock freezes while
 *   paused and while Config is open, and resumes from the time that was left.
 * - After that, the mic adds to the answer ("继续补充"); only Re-record replaces it.
 * - Config → Data can delete the autosave (not while that interview is live) and clear the setup
 *   wizard's remembered data (`igg.setup.v1`).
 */
import { type Page } from '@playwright/test';
import { expect, test } from './support/test';
import {
  FAST_SETTINGS,
  SESSION_KEY,
  advanceInterviewer,
  expectScreen,
  game,
  openTitle,
  seedSettings,
  setupInterview,
  startInterview,
  typeAnswer,
} from './support/app';
import { installFakeSpeech, type FakeSpeechWindow } from './support/fakeSpeech';

const SETUP_KEY = 'igg.setup.v1';
const TAKE_1 = '首先我负责订单服务的重构，然后把核心接口改成异步处理';
const TAKE_2 = '结果接口延迟下降了百分之七十，峰值吞吐提升了三倍';
const TAKE_3 = '这句会被重录替换掉';
const TAKE_4 = '我在上一家公司主导了缓存改造，命中率提升到百分之九十五';

async function sayNext(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => (window as unknown as FakeSpeechWindow).__fakeStt.say(t), text);
}

/** Seconds left on the HUD answer timer ("0:57" → 57). */
async function secondsLeft(page: Page): Promise<number> {
  const text = (await page.getByTestId('hud-timer').locator('.hud-timer__value').textContent()) ?? '';
  const [m, s] = text.trim().split(':').map(Number);
  return m * 60 + s;
}

async function candidateAnswers(page: Page): Promise<string[]> {
  const { session } = await game(page);
  return (session?.transcript ?? []).filter((e) => e.role === 'candidate').map((e) => e.text);
}

test('pausing stops a recording without submitting it; the mic then adds to the answer; the clock freezes while paused or in Config', async ({ page }) => {
  await page.addInitScript(installFakeSpeech);
  await seedSettings(page, {
    display: { uiLang: 'zh', textSpeed: 0 },
    tts: { engine: 'browser' },
    stt: { engine: 'browser', autoSubmit: true },
    audio: { muted: true },
  });
  await openTitle(page);
  await page.getByTestId('title-new').click();
  await setupInterview(page, { character: 'yuki', questions: 'min', followUps: 0 });
  await page.getByTestId('opt-timelimit').locator('[data-value="60"]').click();
  await startInterview(page);

  // ── Self-introduction: the clock starts once the question has been voiced ──
  expect((await advanceInterviewer(page)).kind).toBe('answer');
  const timer = page.getByTestId('hud-timer');
  await expect(timer).toHaveAttribute('data-state', 'running');
  const panel = page.getByTestId('answer-panel');

  // Record, then pause mid-take: the take stops and becomes an editable draft (auto-submit is on).
  await sayNext(page, TAKE_1);
  await page.getByTestId('mic-button').click();
  await expect(panel).toHaveAttribute('data-phase', 'listening');
  await expect(page.getByTestId('answer-live')).toHaveText(TAKE_1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await expect(panel).toHaveAttribute('data-phase', 'review');
  await expect(page.getByTestId('answer-textarea')).toHaveValue(TAKE_1);
  await expect(timer).toHaveAttribute('data-state', 'paused');
  expect(await candidateAnswers(page)).toEqual([]);
  // Frozen while paused (a real wait: the point is that time passes and the clock does not move).
  const frozen = await secondsLeft(page);
  await page.waitForTimeout(1500);
  expect(await secondsLeft(page)).toBe(frozen);
  expect(await candidateAnswers(page)).toEqual([]);

  // Resume: nothing was submitted; the mic now adds to the draft.
  await page.getByTestId('pause-menu').getByRole('button', { name: '继续面试' }).click();
  await expect(page.getByTestId('pause-menu')).toBeHidden();
  await expect(timer).toHaveAttribute('data-state', 'running');
  await expect(panel).toContainText('暂停时录音已停止');
  await expect(page.getByTestId('mic-button')).toHaveAccessibleName('继续补充');
  await sayNext(page, TAKE_2);
  await page.getByTestId('mic-button').click();
  await expect(panel).toHaveAttribute('data-phase', 'listening');
  // While adding, the answer so far stays visible next to the new take.
  await expect(page.getByTestId('answer-live')).toContainText(TAKE_1);
  await expect(page.getByTestId('answer-live')).toContainText('接着说');
  await expect(page.getByTestId('answer-live')).toContainText(TAKE_2);
  // Stopping a normal take auto-submits the whole answer: both takes, in order.
  await page.getByTestId('mic-button').click();
  await expect(panel).toBeHidden();
  const [intro] = await candidateAnswers(page);
  expect(intro).toBe(`${TAKE_1}\n${TAKE_2}`);

  // ── Next question: a trip to Config neither resets nor runs the clock ──
  expect((await advanceInterviewer(page)).kind).toBe('answer');
  await expect(timer).toHaveAttribute('data-state', 'running');
  await expect.poll(() => secondsLeft(page), { timeout: 10_000 }).toBeLessThanOrEqual(57);
  await page.keyboard.press('Escape');
  const beforeConfig = await secondsLeft(page);
  await page.getByTestId('pause-menu').getByRole('button', { name: '设置' }).click();
  await expectScreen(page, 'screen-SettingsScreen');
  await page.waitForTimeout(2500);
  await page.getByTestId('menu-back').click();
  await expectScreen(page, 'screen-InterviewScreen');
  await expect(timer).toHaveAttribute('data-state', 'running');
  const afterConfig = await secondsLeft(page);
  expect(afterConfig).toBeLessThanOrEqual(beforeConfig);
  expect(afterConfig).toBeGreaterThanOrEqual(beforeConfig - 1);

  // Re-record replaces the answer instead of adding to it.
  await sayNext(page, TAKE_3);
  await page.getByTestId('mic-button').click();
  await expect(page.getByTestId('answer-live')).toHaveText(TAKE_3);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('answer-textarea')).toHaveValue(TAKE_3);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeHidden();
  await sayNext(page, TAKE_4);
  await page.getByTestId('answer-rerecord').click();
  await expect(panel).toHaveAttribute('data-phase', 'listening');
  await expect(page.getByTestId('answer-live')).toHaveText(TAKE_4);
  await expect(page.getByTestId('answer-live')).not.toContainText(TAKE_3);
  await page.getByTestId('mic-button').click();
  await expect(panel).toBeHidden();
  expect((await candidateAnswers(page)).at(-1)).toBe(TAKE_4);
});

test('Config → Data: delete the autosave (not while it is live) and clear the setup wizard data', async ({ page }) => {
  await seedSettings(page, FAST_SETTINGS);
  await openTitle(page);
  await page.getByTestId('title-new').click();
  await setupInterview(page, { character: 'ethan', questions: 'min', followUps: 0 });
  await page.getByTestId('opt-role').fill('后端工程师');
  await startInterview(page);
  expect((await advanceInterviewer(page)).kind).toBe('answer');
  await typeAnswer(page, '首先我负责订单服务的重构，然后用 Redis 做缓存，结果接口延迟下降了 70%。');
  expect((await advanceInterviewer(page)).kind).toBe('answer');
  expect(await page.evaluate((k) => localStorage.getItem(k), SETUP_KEY)).not.toBeNull();

  // Config opened from the live interview: the autosave and "erase all" cannot be deleted from here.
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-menu').getByRole('button', { name: '设置' }).click();
  await expectScreen(page, 'screen-SettingsScreen');
  await page.getByRole('tab', { name: /数据/ }).click();
  await expect(page.getByTestId('data-delete-saved')).toBeDisabled();
  await expect(page.getByTestId('data-erase-all')).toBeDisabled();
  await expect(page.getByTestId('data-saved-row')).toContainText('你正在进行这场面试');
  await page.getByTestId('menu-back').click();
  await expectScreen(page, 'screen-InterviewScreen');

  // Save & quit: Continue is offered; deleting the autosave removes it.
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-menu').getByRole('button', { name: '保存并返回标题' }).click();
  await expectScreen(page, 'screen-TitleScreen');
  await expect(page.getByTestId('title-continue')).toBeEnabled();
  await page.getByTestId('title-config').click();
  await expectScreen(page, 'screen-SettingsScreen');
  await page.getByRole('tab', { name: /数据/ }).click();
  const del = page.getByTestId('data-delete-saved');
  await expect(del).toBeEnabled();
  await del.click();
  await page.getByTestId('data-delete-saved-yes').click();
  await expect(page.getByTestId('data-delete-saved')).toBeDisabled();
  await expect(page.getByTestId('data-saved-row')).toContainText('当前没有中断的面试');
  expect(await page.evaluate((k) => localStorage.getItem(k), SESSION_KEY)).toBeNull();

  // Clear the setup wizard data: igg.setup.v1 and the loaded résumé are gone.
  await page.getByTestId('data-clear-setup').click();
  await page.getByTestId('data-clear-setup-yes').click();
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), SETUP_KEY)).toBeNull();
  expect((await game(page)).records).toHaveLength(0);

  await page.getByTestId('menu-back').click();
  await expectScreen(page, 'screen-TitleScreen');
  await expect(page.getByTestId('title-continue')).toBeDisabled();
  await page.getByTestId('title-new').click();
  await expectScreen(page, 'screen-SetupScreen');
  await page.getByTestId('setup-next').click();
  await expect(page.getByTestId('resume-text')).toHaveValue('');
});
