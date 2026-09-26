/**
 * 4 · Autosave: a reload mid-interview offers "Continue" on the title screen, which resumes on the
 * very question that was pinned; "Save & quit" from the Esc menu does the same.
 */
import { expect, test } from './support/test';
import {
  FAST_SETTINGS,
  SESSION_KEY,
  type DevWindow,
  advanceInterviewer,
  expectScreen,
  game,
  openTitle,
  pendingTurnKind,
  questionCard,
  seedSettings,
  setupInterview,
  startInterview,
  typeAnswer,
} from './support/app';

const ANSWER = '首先我负责了订单服务的重构，然后用 Redis 做缓存，结果接口延迟下降了 70%，峰值 QPS 提升 3 倍。';

test('reload mid-interview → Continue resumes on the pinned question; Save & quit → Continue', async ({ page }) => {
  await seedSettings(page, FAST_SETTINGS);
  await openTitle(page);
  await page.getByTestId('title-new').click();
  await setupInterview(page, { character: 'haru', questions: 'min', followUps: 0 });
  await startInterview(page);

  // Answer the self-introduction, then stop on the first main question.
  expect((await advanceInterviewer(page)).kind).toBe('answer');
  await typeAnswer(page, ANSWER);
  expect((await advanceInterviewer(page)).kind).toBe('answer');
  const pinned = (await questionCard(page).textContent()) ?? '';
  const before = await game(page);
  const sessionId = before.session!.id;
  const lastQuestion = before.session!.transcript.at(-1)!;
  expect(lastQuestion.role).toBe('interviewer');
  expect(pinned).toContain(lastQuestion.turn!.question.slice(0, 12));
  // A draft typed but not submitted is not part of the save.
  await page.getByTestId('answer-textarea').fill('还没想好……');
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k) !== null, SESSION_KEY)).toBe(true);

  // ── Reload → title → Continue ──
  await openTitle(page, { reload: true });
  const cont = page.getByTestId('title-continue');
  await expect(cont).toBeEnabled();
  await expect(cont).toHaveClass(/ts-menu__item--selected/);
  await page.keyboard.press('Enter');
  await expectScreen(page, 'screen-InterviewScreen');
  await expect(page.getByTestId('answer-panel')).toBeVisible();
  await expect(questionCard(page)).toContainText(lastQuestion.turn!.question.slice(0, 12));
  await expect(page.getByTestId('answer-textarea')).toHaveValue('');
  const resumed = await game(page);
  expect(resumed.session!.id).toBe(sessionId);
  expect(resumed.session!.transcript).toHaveLength(before.session!.transcript.length);
  expect(resumed.stage.kind).toBe('answer');

  // ── Esc → pause menu → Save & quit → Continue ──
  await page.keyboard.press('Escape');
  const menu = page.getByTestId('pause-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: '保存并返回标题' }).click();
  await expectScreen(page, 'screen-TitleScreen');
  await expect(page.getByTestId('title-continue')).toBeEnabled();
  await page.getByTestId('title-continue').click();
  await expectScreen(page, 'screen-InterviewScreen');
  await expect(questionCard(page)).toContainText(lastQuestion.turn!.question.slice(0, 12));
  await expect(page.getByTestId('answer-textarea')).toHaveValue('');

  // The resumed interview carries on normally.
  await typeAnswer(page, ANSWER);
  expect((await advanceInterviewer(page)).kind).toBe('answer');
  const after = await game(page);
  expect(after.session!.id).toBe(sessionId);
  expect(after.session!.transcript.filter((e) => e.role === 'candidate')).toHaveLength(2);

  // Abandoning clears the autosave: Continue is disabled again.
  await page.keyboard.press('Escape');
  await menu.getByRole('button', { name: '放弃本次面试' }).click();
  await menu.getByRole('button', { name: '确定放弃' }).click();
  await expectScreen(page, 'screen-TitleScreen');
  await expect(page.getByTestId('title-continue')).toBeDisabled();
  expect(await page.evaluate((k) => localStorage.getItem(k), SESSION_KEY)).toBeNull();
});

test('reload while the interviewer prepares, thinks or evaluates re-runs that step on Continue', async ({ page }) => {
  await seedSettings(page, FAST_SETTINGS);
  await openTitle(page);
  await page.getByTestId('title-new').click();
  await setupInterview(page, { character: 'ethan', questions: 'min', followUps: 0 });

  // ── Reload while the résumé is still being read (phase "preparing") ──
  await page.evaluate(() => (window as unknown as DevWindow).__demo.setDelay(60_000));
  await startInterview(page);
  await expect(page.getByTestId('screen-InterviewScreen')).toHaveAttribute('data-stage', 'loading');
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.phase, SESSION_KEY)).toBe('preparing');
  await openTitle(page, { reload: true });
  await page.getByTestId('title-continue').click();
  expect((await advanceInterviewer(page)).kind).toBe('answer');
  expect((await pendingTurnKind(page))).toBe('opening');

  // ── Submit an answer while the (slowed-down) interviewer thinks, then reload ──
  await page.evaluate(() => (window as unknown as DevWindow).__demo.setDelay(60_000));
  await page.getByTestId('answer-textarea').fill(ANSWER);
  await page.getByTestId('answer-textarea').press('Control+Enter');
  await expect(page.getByTestId('screen-InterviewScreen')).toHaveAttribute('data-stage', 'loading');
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), SESSION_KEY);
  expect(saved.transcript.at(-1)).toMatchObject({ role: 'candidate', text: ANSWER });

  await openTitle(page, { reload: true });
  await page.getByTestId('title-continue').click();
  // The last entry is the candidate's: the next turn is requested again.
  expect((await advanceInterviewer(page)).kind).toBe('answer');
  let state = await game(page);
  expect(state.session!.transcript.filter((e) => e.role === 'candidate').map((e) => e.text)).toEqual([ANSWER]);
  expect(state.session!.transcript.at(-1)!.turn!.kind).toBe('main');

  // ── Finish the questions quickly, then reload during the evaluation ──
  for (let guard = 0; guard < 20; guard++) {
    const kind = await pendingTurnKind(page);
    if (kind === 'reverse_prompt' || kind === 'reverse_answer') {
      await page.getByTestId('answer-end-reverse').click();
      break;
    }
    await typeAnswer(page, ANSWER);
    expect((await advanceInterviewer(page)).kind).toBe('answer');
  }
  // The goodbye is presented next: slow the evaluation down, then click through the closing line.
  await page.evaluate(() => (window as unknown as DevWindow).__demo.setDelay(60_000));
  expect((await advanceInterviewer(page, { untilEvaluating: true })).phase).toBe('evaluating');
  await expect(page.getByTestId('screen-InterviewScreen')).toHaveAttribute('data-stage', 'loading');
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.phase, SESSION_KEY)).toBe('evaluating');

  await openTitle(page, { reload: true });
  await page.getByTestId('title-continue').click();
  await expectScreen(page, 'screen-ResultScreen');
  state = await game(page);
  expect(state.lastRecord!.characterId).toBe('ethan');
  expect(state.records).toHaveLength(1);
  expect(await page.evaluate((k) => localStorage.getItem(k), SESSION_KEY)).toBeNull();
});
