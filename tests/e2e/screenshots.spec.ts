/**
 * Not a test: regenerates the README screenshots (docs/screenshots/*.png) through the real UI —
 * the offline demo interviewer, fake browser speech (support/fakeSpeech.ts), 1280×720. Run it after
 * changing the art or the screens:
 *
 *   DOCS_SCREENSHOTS=1 npx playwright test screenshots --project=chromium
 */
import type { Page } from '@playwright/test';
import { installFakeSpeech, type FakeSpeechWindow } from './support/fakeSpeech';
import { advanceInterviewer, expectScreen, openTitle, pendingTurnKind, seedSettings, setupInterview, startInterview, waitForAnswerStage, type DevWindow } from './support/app';
import { expect, test } from './support/test';

test.skip(!process.env.DOCS_SCREENSHOTS, 'regenerates docs/screenshots — set DOCS_SCREENSHOTS=1');
test.setTimeout(240_000);

const DIR = 'docs/screenshots';

const SELF_INTRO =
  '面试官您好，我叫张晓明，毕业于浙江大学计算机专业。之前在星河云科技做后端实习，负责订单服务重构，把接口 P99 延迟从 800ms 降到了 120ms。';
const RICH_ANSWER =
  '首先说背景：当时订单状态流转分散在 6 个服务里，线上每周大约有 40 单状态不一致的工单。我的任务是把它收敛成统一的状态机。然后我梳理了全部 23 种状态和流转条件，设计了“状态机 + 事件表”，所有变更都先写事件再驱动状态，并补了对账任务。结果不一致工单降到每周 3 单以内，新增一种订单类型的开发时间也从一周缩短到两天。';
const REVERSE_QUESTION = '请问团队现在最想解决的技术挑战是什么？新人一般怎么上手？';
const EN_INTRO =
  "Hi, I'm Alex Chen. I studied computer science and interned on a backend team, where I rebuilt an order service and cut its p99 latency from 800 ms to 120 ms.";

/** Let every picture load, wait out the entrance animations, then shoot — with eyes open. */
async function shot(page: Page, name: string, settleMs = 1200): Promise<void> {
  await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
  await page.waitForTimeout(settleMs);
  // A blink (120 ms every 2–6 s per sprite) could start between any check and the capture: hide the
  // closed-eye frames for the screenshot instead.
  const noBlink = await page.addStyleTag({ content: '.cs-root .cs-blink { visibility: hidden !important; }' });
  await page.screenshot({ path: `${DIR}/${name}.png` });
  await noBlink.evaluate((el) => (el as HTMLStyleElement).remove());
}

async function say(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => (window as unknown as FakeSpeechWindow).__fakeStt.say(t), text);
}

/** Answer by voice (fake recognition), optionally shooting the panel while it listens. */
async function voiceAnswer(page: Page, text: string, shotName?: string): Promise<void> {
  await waitForAnswerStage(page);
  await say(page, text);
  await page.getByTestId('mic-button').click();
  await expect(page.getByTestId('answer-live')).toHaveText(text);
  if (shotName) await shot(page, shotName, 600);
  await page.getByTestId('mic-button').click();
  await expect(page.getByTestId('answer-textarea')).toHaveValue(text);
  await page.getByTestId('answer-submit').click();
  await expect(page.getByTestId('answer-panel')).toBeHidden();
}

/**
 * Wait for the next finished interviewer page (dismissing chapter cards). Returns the sprite's
 * expression, or null when the answer stage / result came first.
 */
async function nextInterviewerPage(page: Page): Promise<string | null> {
  for (let guard = 0; guard < 20; guard++) {
    const state = await (
      await page.waitForFunction(() => {
        const s = (window as unknown as DevWindow).__stores.game.getState();
        if (s.screen !== 'interview' || s.stage.kind === 'answer' || s.stage.kind === 'error') return 'gone';
        if (document.querySelector('[data-testid="chapter-card"]')) return 'card';
        if (s.stage.kind === 'interviewer' && document.querySelector('.dlg-text__next')) return 'page';
        return null;
      })
    ).jsonValue();
    if (state === 'gone') return null;
    if (state === 'page') return page.locator('.cs-sprite').first().getAttribute('data-expression');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => !document.querySelector('[data-testid="chapter-card"]'));
  }
  return null;
}

test('zh: title, setup, interview by voice, ending CG and report', async ({ page }) => {
  await page.addInitScript(installFakeSpeech);
  await seedSettings(page, {
    display: { uiLang: 'zh', textSpeed: 0 },
    tts: { engine: 'browser' },
    stt: { engine: 'browser', autoSubmit: false },
    audio: { muted: true },
  });
  await openTitle(page);
  await shot(page, 'title', 2500);

  await page.getByTestId('title-new').click();
  await expectScreen(page, 'screen-SetupScreen');
  await page.getByTestId('char-card-ethan').click();
  await shot(page, 'setup-interviewer');

  await setupInterview(page, { character: 'yuki', questions: 'min', followUps: 1 });
  await startInterview(page);

  let dialogueShot = false;
  let mainAnswered = 0;
  for (let turn = 0; turn < 30; turn++) {
    const state = await advanceInterviewer(page);
    if (state.screen === 'result') break;
    expect(state.kind, 'no AI errors in the demo').toBe('answer');
    const kind = await pendingTurnKind(page);
    if (kind === 'opening') await voiceAnswer(page, SELF_INTRO);
    else if (kind === 'main' || kind === 'followup') {
      if (kind === 'main') mainAnswered++;
      await voiceAnswer(page, RICH_ANSWER, mainAnswered === 1 && kind === 'main' ? 'interview-answer' : undefined);
      if (!dialogueShot) {
        // The interviewer reacting to a strong answer.
        const expression = await nextInterviewerPage(page);
        if (expression === 'happy' || expression === 'smile') {
          await shot(page, 'interview-dialogue');
          dialogueShot = true;
        }
      }
    } else if (kind === 'reverse_prompt') await voiceAnswer(page, REVERSE_QUESTION);
    else if (kind === 'reverse_answer') {
      await page.getByTestId('answer-end-reverse').click();
      await expect(page.getByTestId('answer-panel')).toBeHidden();
    } else throw new Error(`unexpected turn kind ${kind}`);
  }
  expect(dialogueShot, 'the interviewer smiled at some point').toBe(true);

  await expectScreen(page, 'screen-ResultScreen');
  await expect(page.getByTestId('result-stamp')).toBeVisible();
  await shot(page, 'result-ending', 3500);
  await page.getByTestId('result-to-report').click();
  await expect(page.getByTestId('report-view')).toBeVisible();
  await shot(page, 'report-overview', 2000);
});

test('en: Ethan interviewing in English', async ({ page }) => {
  await page.addInitScript(installFakeSpeech);
  await seedSettings(page, {
    display: { uiLang: 'en', textSpeed: 0 },
    tts: { engine: 'browser' },
    stt: { engine: 'browser', autoSubmit: false },
    audio: { muted: true },
  });
  await openTitle(page);
  await page.getByTestId('title-new').click();
  await setupInterview(page, { character: 'ethan', lang: 'en', questions: 'min', followUps: 0 });
  await startInterview(page);
  await advanceInterviewer(page);
  await voiceAnswer(page, EN_INTRO);
  expect(await nextInterviewerPage(page)).not.toBeNull();
  await shot(page, 'interview-english');
});

test('zh: Config, AI model tab', async ({ page }) => {
  await seedSettings(page, {
    display: { uiLang: 'zh', textSpeed: 0 },
    tts: { engine: 'off' },
    audio: { muted: true },
    llm: { presetId: 'anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-api03-screenshot-placeholder-key-000000', model: 'claude-opus-5' },
  });
  await openTitle(page);
  await page.getByTestId('title-config').click();
  await expectScreen(page, 'screen-SettingsScreen');
  await shot(page, 'settings-llm');
});
