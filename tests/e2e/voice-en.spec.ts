/**
 * 2 · English UI + English interview on the voice path. Browser speech is faked (see
 * support/fakeSpeech.ts): the interviewer's lines must reach speechSynthesis in English with a
 * matching voice, and two answers are given by "voice" (mic button / M key → live transcript →
 * submit). Auto-advance is on, so the interviewer pages turn themselves when each line is voiced.
 */
import { type Page } from '@playwright/test';
import { expect, test } from './support/test';
import { game, openTitle, seedSettings, setupInterview, startInterview, waitForAnswerStage } from './support/app';
import { installFakeSpeech, type FakeSpeechWindow, type FakeUtteranceRecord } from './support/fakeSpeech';

const ANSWER_1 =
  'Hi, I am Alex Chen, a frontend engineer. First I rebuilt our checkout in React and TypeScript, then we cut load time by 45 percent, and as a result conversion grew 12 percent.';
const ANSWER_2 =
  'First I profiled the bundle, then I split the routes and cached the API calls. As a result the p95 latency dropped from 900 ms to 300 ms and support tickets fell by 30 percent.';

async function spoken(page: Page): Promise<FakeUtteranceRecord[]> {
  return page.evaluate(() => (window as unknown as FakeSpeechWindow).__fakeTts.spoken);
}

async function sayNext(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => (window as unknown as FakeSpeechWindow).__fakeStt.say(t), text);
}

test('English UI and interview answered by voice, with the interviewer voiced in English', async ({ page }) => {
  await page.addInitScript(installFakeSpeech);
  await seedSettings(page, {
    display: { uiLang: 'zh', textSpeed: 0, autoAdvance: true, autoDelayMs: 0 },
    tts: { engine: 'browser' },
    stt: { engine: 'browser', autoSubmit: false },
  });
  await openTitle(page);

  // ── Switch the UI to English from the title screen ──
  await page.getByTestId('lang-switch').getByRole('radio', { name: 'EN' }).click();
  await expect(page.getByRole('button', { name: /New Interview/ })).toBeVisible();
  await expect(page).toHaveTitle(/^Interview Story/);
  await page.getByRole('button', { name: /New Interview/ }).click();

  // ── Setup: Ethan (male voice), English interview, sample résumé ──
  await setupInterview(page, { character: 'ethan', lang: 'en', questions: 'min', followUps: 0 });
  await expect(page.getByTestId('opt-lang').getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('device-check')).toContainText('Browser voice');

  // Device check: "Hear their voice" speaks the English greeting with an English male voice.
  await page.getByTestId('device-tts-test').click();
  await expect.poll(async () => (await spoken(page)).map((u) => u.text).join(' ')).toContain('Ethan');
  const greeting = (await spoken(page)).find((u) => u.text.includes('Ethan'))!;
  expect(greeting.lang).toBe('en-US');
  expect(greeting.voice).toMatch(/Guy/);
  // Mic check: Chromium's fake capture device (a periodic beep) goes through getUserMedia + the analyser.
  await page.getByTestId('device-mic-test').click();
  await expect(page.getByTestId('device-check')).toContainText(/Your microphone works!|Very quiet/, { timeout: 10_000 });
  const spokenBeforeInterview = (await spoken(page)).length;
  await startInterview(page);

  // ── Q0 (self-introduction): mic button → live transcript → stop → edit-free submit ──
  await waitForAnswerStage(page);
  await expect(page.getByTestId('answer-panel')).toHaveAttribute('data-mode', 'voice');
  await sayNext(page, ANSWER_1);
  await page.getByTestId('mic-button').click();
  await expect(page.getByTestId('answer-panel')).toHaveAttribute('data-phase', 'listening');
  await expect(page.getByTestId('answer-live')).toHaveText(ANSWER_1);
  await expect(page.getByTestId('mic-button')).toHaveAccessibleName('Done');
  await page.getByTestId('mic-button').click();
  await expect(page.getByTestId('answer-textarea')).toHaveValue(ANSWER_1);
  await expect(page.getByTestId('answer-panel')).toContainText('Got it');
  await page.getByTestId('answer-submit').click();
  await expect(page.getByTestId('answer-panel')).toBeHidden();

  // ── Q1: the M hotkey starts / stops the mic, Ctrl+Enter submits ──
  await waitForAnswerStage(page);
  await sayNext(page, ANSWER_2);
  await page.keyboard.press('m');
  await expect(page.getByTestId('answer-live')).toHaveText(ANSWER_2);
  await page.keyboard.press('m');
  await expect(page.getByTestId('answer-textarea')).toHaveValue(ANSWER_2);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('answer-panel')).toBeHidden();
  await waitForAnswerStage(page);

  // ── The answers were stored as voice answers ──
  const { session } = await game(page);
  const answers = session!.transcript.filter((e) => e.role === 'candidate');
  expect(answers.map((e) => e.text)).toEqual([ANSWER_1, ANSWER_2]);
  expect(answers.every((e) => e.answer?.via === 'voice')).toBe(true);
  expect(session!.config.lang).toBe('en');

  // ── Recognition ran in English, continuous with interim results ──
  const starts = await page.evaluate(() => (window as unknown as FakeSpeechWindow).__fakeStt.starts);
  expect(starts.length).toBeGreaterThanOrEqual(2);
  for (const s of starts) expect(s).toEqual({ lang: 'en-US', continuous: true, interimResults: true });

  // ── Every interviewer line was voiced in English with the male English voice ──
  const interviewerText = session!.transcript
    .filter((e) => e.role === 'interviewer')
    .map((e) => e.text)
    .join(' ')
    .replace(/\s+/g, ' ');
  const lines = (await spoken(page)).slice(spokenBeforeInterview);
  for (const u of lines) {
    expect(u.lang).toBe('en-US');
    expect(u.voice).toMatch(/Guy/);
  }
  // Played to the end with word boundaries (the lip-sync pulses); only a line cut off by the mic may differ.
  const ended = lines.filter((u) => u.outcome === 'end');
  expect(ended.length).toBeGreaterThanOrEqual(3);
  for (const u of ended) expect(u.boundaries).toBe(2);
  // The spoken chunks are the interviewer's words (the question is voiced too).
  const firstQuestion = session!.transcript.find((e) => e.turn?.kind === 'opening')!.turn!.question;
  const voicedText = lines.map((u) => u.text).join(' ');
  expect(voicedText.replace(/\s+/g, ' ')).toContain(firstQuestion.replace(/\s+/g, ' ').slice(0, 30));
  for (const u of lines.slice(0, 3)) expect(interviewerText).toContain(u.text.replace(/\s+/g, ' ').slice(0, 20));
});

test('Chinese interview: the browser voice picked in Config is used; a recognition network error falls back to typing', async ({ page }) => {
  await page.addInitScript(installFakeSpeech);
  await seedSettings(page, {
    display: { uiLang: 'zh', textSpeed: 0, autoAdvance: true, autoDelayMs: 0 },
    tts: { engine: 'browser' },
    stt: { engine: 'browser' },
  });
  await openTitle(page);

  // ── Config → 语音: pick the (male) Yunxi voice for Chinese and preview it ──
  await page.getByTestId('title-config').click();
  await page.getByRole('tab', { name: /语音/ }).click();
  const zhVoice = page.getByTestId('tts-voice-zh');
  await expect(zhVoice.locator('option')).toHaveText(['自动（按面试官性别挑选）', /Xiaoxiao.*zh-CN/, /Yunxi.*zh-CN/]);
  await zhVoice.selectOption('fake-zh-male');
  await page.getByTestId('tts-preview-browser-zh').click();
  await expect.poll(async () => (await spoken(page)).length).toBeGreaterThan(0);
  expect((await spoken(page))[0]).toMatchObject({ lang: 'zh-CN', voice: expect.stringMatching(/Yunxi/) });
  expect((await spoken(page))[0].text).toContain('欢迎参加今天的面试');
  await page.getByTestId('menu-back').click();

  // ── A Chinese interview with Yuki: her lines use the chosen voice ──
  await page.getByTestId('title-new').click();
  await setupInterview(page, { character: 'yuki', lang: 'zh', questions: 'min', followUps: 0 });
  const spokenBeforeInterview = (await spoken(page)).length;
  await startInterview(page);
  await waitForAnswerStage(page);
  const lines = (await spoken(page)).slice(spokenBeforeInterview);
  expect(lines.length).toBeGreaterThan(0);
  for (const u of lines) expect(u).toMatchObject({ lang: 'zh-CN', voice: expect.stringMatching(/Yunxi/) });

  // ── The recognizer can't reach its service: a localized hint, then typing still works ──
  await page.evaluate(() => (window as unknown as FakeSpeechWindow).__fakeStt.failNext('network'));
  await page.getByTestId('mic-button').click();
  const panel = page.getByTestId('answer-panel');
  await expect(panel).toHaveAttribute('data-phase', 'error');
  await expect(panel.getByRole('status')).toContainText('语音识别服务连接失败');
  const starts = await page.evaluate(() => (window as unknown as FakeSpeechWindow).__fakeStt.starts);
  expect(starts.at(-1)).toMatchObject({ lang: 'zh-CN' });
  await page.getByTestId('answer-use-keyboard').click();
  await expect(panel).toHaveAttribute('data-mode', 'keyboard');
  await page.getByTestId('answer-textarea').fill('我叫张晓明，做过两段后端实习，负责订单服务重构，延迟下降了 70%。');
  await page.getByTestId('answer-textarea').press('Control+Enter');
  await waitForAnswerStage(page);
  const { session } = await game(page);
  expect(session!.transcript.find((e) => e.role === 'candidate')!.answer!.via).toBe('text');
});
