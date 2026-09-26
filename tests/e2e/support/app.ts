/**
 * Shared E2E helpers: seeding settings, opening the app with the demo fast path, reading the
 * zustand stores exposed in dev (`window.__stores`) and driving the interview scene through the
 * real UI (keyboard / clicks). Everything waits on UI or store state — no fixed sleeps.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export const SETTINGS_KEY = 'igg.settings.v1';
export const SESSION_KEY = 'igg.session.v1';

/** Minimal view of the game store used by the tests (the real types live in src/). */
export interface StageView {
  kind: 'idle' | 'loading' | 'interviewer' | 'answer' | 'error' | 'ended';
  entryId?: string;
  code?: string;
  reason?: string;
}

export interface TranscriptView {
  id: string;
  role: 'interviewer' | 'candidate';
  text: string;
  turn?: { kind: string; question: string; reaction: string };
  answer?: { via: 'voice' | 'text'; skipped: boolean };
}

export interface SessionView {
  id: string;
  phase: string;
  transcript: TranscriptView[];
  config: { lang: 'zh' | 'en'; characterId: string; mainQuestions: number };
}

export interface RecordView {
  id: string;
  characterId: string;
  ending: 'perfect' | 'offer' | 'pending' | 'rejected';
  finalScore: number;
  lang: 'zh' | 'en';
  transcript: TranscriptView[];
  report: { summary: string; questionReviews: { question: string }[]; finalMessage: string };
}

export interface GameView {
  screen: string;
  stage: StageView;
  session: SessionView | null;
  lastRecord: RecordView | null;
  records: RecordView[];
  endings: Record<string, number>;
}

interface StoreLike<T> {
  getState(): T;
}

/** The dev-only globals the app exposes (see App.tsx). */
export interface DevWindow {
  __stores: { game: StoreLike<GameView>; settings: StoreLike<{ settings: Record<string, unknown>; proxyAvailable: boolean | null }> };
  __demo: { setDelay(ms: number): Promise<void> };
}

/** Settings seeded before the app boots (deep-merged over the defaults by the settings store). */
export interface SeedSettings {
  playerName?: string;
  display?: Partial<{ uiLang: 'zh' | 'en'; textSpeed: number; autoAdvance: boolean; autoDelayMs: number; reduceMotion: boolean }>;
  tts?: Partial<{ engine: 'browser' | 'api' | 'off' }>;
  stt?: Partial<{ engine: 'browser' | 'api' | 'keyboard'; autoSubmit: boolean }>;
  llm?: Record<string, unknown>;
  audio?: Partial<{ muted: boolean }>;
}

/** The fast, deterministic baseline: instant text, silent TTS, keyboard answers, muted audio. */
export const FAST_SETTINGS: SeedSettings = {
  display: { uiLang: 'zh', textSpeed: 0 },
  tts: { engine: 'off' },
  stt: { engine: 'keyboard' },
  audio: { muted: true },
};

/**
 * Seed settings into localStorage before the first page script runs. Only applied when nothing is
 * stored yet, so a reload keeps whatever the app (or the test, through the UI) saved since.
 */
export async function seedSettings(page: Page, settings: SeedSettings): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, JSON.stringify({ state: { settings: value }, version: 1 }));
    },
    { key: SETTINGS_KEY, value: settings },
  );
}

/** Demo interviewer without its artificial "thinking" delay (module state: call again after a reload). */
export async function fastDemo(page: Page): Promise<void> {
  await page.waitForFunction(() => typeof (window as unknown as Partial<DevWindow>).__demo?.setDelay === 'function');
  await page.evaluate(() => (window as unknown as DevWindow).__demo.setDelay(0));
}

/** Open (or reload into) the title screen with the demo fast path enabled. */
export async function openTitle(page: Page, opts: { reload?: boolean } = {}): Promise<void> {
  if (opts.reload) await page.reload();
  else await page.goto('/');
  await expect(page.getByTestId('screen-TitleScreen')).toBeVisible();
  await fastDemo(page);
}

/** Snapshot of the game store (JSON-cloned). */
export async function game(page: Page): Promise<GameView> {
  return page.evaluate(() => {
    const s = (window as unknown as DevWindow).__stores.game.getState();
    return JSON.parse(JSON.stringify({ screen: s.screen, stage: s.stage, session: s.session, lastRecord: s.lastRecord, records: s.records, endings: s.endings })) as GameView;
  });
}

/** Wait until the screen with this `data-testid` (e.g. `screen-TitleScreen`) is displayed. */
export async function expectScreen(page: Page, testId: string): Promise<void> {
  await expect(page.getByTestId(testId)).toBeVisible();
}

type SceneAction = 'done' | 'card' | 'page';
export interface SceneState extends StageView {
  screen: string;
  phase: string | null;
  action: SceneAction;
  text?: string;
}

/**
 * Advance the interviewer with Space until the player has to answer, an error dialog shows, or the
 * Result screen is reached — or, with `untilEvaluating`, as soon as the goodbye has been presented
 * and the evaluation started.
 *
 * Space is only pressed when it has a definite effect: a chapter card is on screen (dismiss it) or a
 * finished page shows ▼ (turn it). A question page hands over by itself after a short beat. Then the
 * helper waits for exactly that effect, so it never races the card appearing a frame after the line
 * (a "same signature before and after" wait would hang there).
 */
export async function advanceInterviewer(page: Page, opts: { untilEvaluating?: boolean } = {}): Promise<SceneState> {
  for (let guard = 0; guard < 80; guard++) {
    const handle = await page.waitForFunction((untilEval) => {
      const s = (window as unknown as DevWindow).__stores.game.getState();
      const base = { ...s.stage, screen: s.screen, phase: s.session?.phase ?? null };
      if (s.screen === 'result') return { ...base, action: 'done' };
      if (s.screen !== 'interview') return null;
      if (untilEval && s.session?.phase === 'evaluating') return { ...base, action: 'done' };
      if (s.stage.kind === 'answer' || s.stage.kind === 'error') return { ...base, action: 'done' };
      if (s.stage.kind !== 'interviewer' || !document.querySelector('[data-testid="screen-InterviewScreen"]')) return null;
      if (document.querySelector('[data-testid="chapter-card"]')) return { ...base, action: 'card' };
      if (document.querySelector('.dlg-text__next')) {
        return { ...base, action: 'page', text: document.querySelector('.dlg-text .gg-visually-hidden')?.textContent ?? '' };
      }
      return null;
    }, opts.untilEvaluating ?? false);
    const state = (await handle.jsonValue()) as SceneState;
    if (state.action === 'done') return state;
    await page.keyboard.press('Space');
    if (state.action === 'card') {
      await page.waitForFunction(() => !document.querySelector('[data-testid="chapter-card"]'));
    } else {
      await page.waitForFunction((prev) => {
        const s = (window as unknown as DevWindow).__stores.game.getState();
        const text = document.querySelector('.dlg-text .gg-visually-hidden')?.textContent ?? '';
        return s.screen !== 'interview' || s.stage.kind !== 'interviewer' || s.stage.entryId !== prev.entryId || text !== prev.text;
      }, state);
    }
  }
  throw new Error('The interviewer never handed over to the player');
}

/** Wait (without pressing anything) until the player must answer — used with auto-advance. */
export async function waitForAnswerStage(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as DevWindow).__stores.game.getState().stage.kind === 'answer');
  await expect(page.getByTestId('answer-panel')).toBeVisible();
}

/** The pinned question card's text. */
export function questionCard(page: Page): Locator {
  return page.getByTestId('question-card');
}

/** Type an answer into the keyboard panel and submit it with Ctrl+Enter. */
export async function typeAnswer(page: Page, text: string): Promise<void> {
  const box = page.getByTestId('answer-textarea');
  await expect(box).toBeEditable();
  await box.fill(text);
  await box.press('Control+Enter');
  await expect(page.getByTestId('answer-panel')).toBeHidden();
}

/** Kind of the interviewer turn the player is answering. */
export async function pendingTurnKind(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const s = (window as unknown as DevWindow).__stores.game.getState();
    const entries = s.session?.transcript ?? [];
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].role === 'interviewer') return entries[i].turn?.kind ?? null;
    return null;
  });
}

/** Read a downloaded file as UTF-8 text. */
export async function readDownload(download: import('@playwright/test').Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

/** Setup wizard up to step 3: pick an interviewer, use the sample résumé, set the options (Start is separate). */
export async function setupInterview(
  page: Page,
  opts: { character?: 'yuki' | 'ethan' | 'haru'; lang?: 'zh' | 'en'; questions?: 'min' | number; followUps?: number } = {},
): Promise<void> {
  await expectScreen(page, 'screen-SetupScreen');
  if (opts.character) await page.getByTestId(`char-card-${opts.character}`).click();
  await page.getByTestId('setup-next').click();
  // The sample résumé follows the interview language (an untouched sample is swapped on step 3).
  await page.getByTestId('resume-sample').click();
  await expect(page.getByTestId('resume-text')).not.toHaveValue('');
  await page.getByTestId('setup-next').click();
  await expect(page.getByTestId('device-check')).toBeVisible();
  if (opts.lang) await page.getByTestId('opt-lang').locator(`[data-value="${opts.lang}"]`).click();
  if (opts.questions !== undefined) {
    const slider = page.getByTestId('opt-questions');
    await slider.focus();
    if (opts.questions === 'min') await slider.press('Home');
    else await slider.fill(String(opts.questions));
  }
  if (opts.followUps !== undefined) await page.getByTestId('opt-followups').locator(`[data-value="${opts.followUps}"]`).click();
}

/** Press Start on step 3 and wait for the interview scene. */
export async function startInterview(page: Page): Promise<void> {
  await page.getByTestId('setup-next').click();
  await expectScreen(page, 'screen-InterviewScreen');
}
