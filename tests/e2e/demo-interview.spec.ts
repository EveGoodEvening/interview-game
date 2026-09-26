/**
 * 1 · A full offline (demo) interview in Chinese, answered with the keyboard, through the real UI:
 * title → setup → every interview phase (self-intro, main questions, follow-ups, a skipped
 * question, reverse Q&A, closing) → result → report tabs → exports → records → endings gallery.
 */
import { expect, test } from './support/test';
import {
  FAST_SETTINGS,
  advanceInterviewer,
  expectScreen,
  game,
  openTitle,
  pendingTurnKind,
  questionCard,
  readDownload,
  seedSettings,
  setupInterview,
  startInterview,
  typeAnswer,
} from './support/app';

const SELF_INTRO =
  '面试官您好，我叫张晓明，毕业于浙江大学计算机专业。首先，我在星河云科技做后端实习，负责订单服务重构，然后把接口 P99 延迟从 800ms 降到 120ms，结果峰值 QPS 提升了 3 倍。';
const RICH_ANSWER =
  '首先，我先用 Redis 和 Kafka 梳理了瓶颈，然后把订单状态机拆成独立服务，并补齐了 85% 的单元测试覆盖率。结果上线后故障工单下降了 90%，每月节省服务器成本约 2 万元。';
const REVERSE_QUESTION = '请问团队现在的技术栈和新人培养机制是怎样的？';

test('demo interview in Chinese, keyboard answers, through result, exports, records and gallery', async ({ page }) => {
  await seedSettings(page, FAST_SETTINGS);
  await openTitle(page);

  // ── Title ──
  await expect(page.getByTestId('title-continue')).toBeDisabled();
  await page.getByRole('button', { name: /开始面试/ }).click();

  // ── Setup: Yuki, sample résumé, 3 questions, ≤ 1 follow-up ──
  await setupInterview(page, { character: 'yuki', questions: 'min', followUps: 1 });
  await expect(page.getByTestId('opt-questions')).toHaveValue('3');
  await startInterview(page);

  // ── Interview ──
  // Quick-menu "跳过" while the prologue card is up goes straight to the answer, card included.
  await expect(page.getByTestId('chapter-card')).toBeVisible();
  await page.getByTestId('quick-skip').click();
  expect(await page.getByTestId('chapter-card').count()).toBe(0);
  await expect(page.getByTestId('answer-panel')).toBeVisible();

  const seen = new Set<string>();
  let mainAnswered = 0;
  let skipped = false;
  for (let turn = 0; turn < 30; turn++) {
    const state = await advanceInterviewer(page);
    if (state.screen === 'result') break;
    expect(state.kind, 'no AI errors in the demo').toBe('answer');
    await expect(questionCard(page)).toBeVisible();
    const kind = (await pendingTurnKind(page)) ?? 'unknown';
    seen.add(kind);
    switch (kind) {
      case 'opening':
        await typeAnswer(page, SELF_INTRO);
        break;
      case 'main':
      case 'followup':
        if (kind === 'main') mainAnswered++;
        if (kind === 'main' && mainAnswered === 1) {
          // The backlog (quick menu "记录") shows the conversation so far; Esc closes it.
          await page.getByTestId('quick-log').click();
          const backlog = page.getByTestId('backlog');
          await expect(backlog).toContainText(SELF_INTRO);
          await expect(backlog).toContainText('开场');
          await page.keyboard.press('Escape');
          await expect(backlog).toBeHidden();
          await expect(page.getByTestId('pause-menu')).toHaveCount(0);

          // A draft survives a trip to Config (quick menu) and back; no chapter card is replayed.
          const draft = page.getByTestId('answer-textarea');
          await draft.fill('先写一半的草稿');
          await page.getByTestId('quick-config').click();
          await expectScreen(page, 'screen-SettingsScreen');
          await page.getByTestId('menu-back').click();
          await expectScreen(page, 'screen-InterviewScreen');
          await expect(page.getByTestId('answer-textarea')).toHaveValue('先写一半的草稿');
          await expect(page.getByTestId('chapter-card')).toHaveCount(0);
        }
        if (kind === 'main' && mainAnswered === 2 && !skipped) {
          // Skip the second main question (with the inline confirmation).
          await page.getByTestId('answer-skip').click();
          await page.getByTestId('answer-skip-yes').click();
          await expect(page.getByTestId('answer-panel')).toBeHidden();
          skipped = true;
        } else await typeAnswer(page, RICH_ANSWER);
        break;
      case 'reverse_prompt':
        await typeAnswer(page, REVERSE_QUESTION);
        break;
      case 'reverse_answer':
        await page.getByTestId('answer-end-reverse').click();
        await expect(page.getByTestId('answer-panel')).toBeHidden();
        break;
      default:
        throw new Error(`unexpected turn kind ${kind}`);
    }
  }
  expect([...seen]).toEqual(expect.arrayContaining(['opening', 'main', 'reverse_prompt', 'reverse_answer']));
  expect(skipped).toBe(true);

  // ── Result CG ──
  await expectScreen(page, 'screen-ResultScreen');
  const { lastRecord } = await game(page);
  expect(lastRecord).not.toBeNull();
  const record = lastRecord!;
  const kinds = record.transcript.map((e) => e.turn?.kind).filter(Boolean);
  expect(kinds[0]).toBe('opening');
  expect(kinds.at(-1)).toBe('closing');
  expect(record.transcript.some((e) => e.answer?.skipped)).toBe(true);
  await expect(page.getByTestId('result-stamp')).toBeVisible();
  await expect(page.getByTestId('result-score')).toBeVisible();
  await expect(page.getByTestId('result-toast')).toContainText('结局解锁');
  await page.getByTestId('result-to-report').click();
  await expect(page.getByTestId('screen-ResultScreen')).toHaveAttribute('data-view', 'report');

  // ── Report tabs ──
  const report = page.getByTestId('report-view');
  await expect(report.getByRole('tab', { name: '总览' })).toHaveAttribute('aria-selected', 'true');
  await expect(report.getByRole('heading', { name: '总评' })).toBeVisible();
  await expect(report.getByRole('heading', { name: '能力雷达' })).toBeVisible();
  await report.getByTestId('report-tab-questions').click();
  await expect(report.locator('.rpt-q')).toHaveCount(record.report.questionReviews.length);
  expect(record.report.questionReviews.length).toBeGreaterThanOrEqual(3);
  await report.getByTestId('report-tab-transcript').click();
  await expect(report.getByRole('tabpanel')).toContainText(SELF_INTRO.slice(0, 20));
  await expect(report.getByRole('tabpanel')).toContainText('（跳过了这道题）');
  await expect(report.getByRole('tabpanel')).toContainText('— 面试结束 —');

  // ── Exports ──
  const [md] = await Promise.all([page.waitForEvent('download'), report.getByTestId('report-export-md').click()]);
  expect(md.suggestedFilename()).toMatch(/^interview-story_yuki_\d{8}-\d{4}\.md$/);
  const markdown = await readDownload(md);
  expect(markdown).toMatch(/^# 面试报告 · /);
  for (const heading of ['## 总评', '## 能力维度', '## 逐题复盘', '## 面试实录', '## 面试官寄语']) expect(markdown).toContain(heading);
  expect(markdown).toContain(SELF_INTRO);
  expect(markdown).toContain(REVERSE_QUESTION);
  expect(markdown).toContain('*（跳过了这道题）*');
  expect(markdown).toContain(`**${Math.round(record.finalScore)}** / 100`);
  await expect(report.getByRole('status')).toContainText('已开始下载');

  const [json] = await Promise.all([page.waitForEvent('download'), report.getByTestId('report-export-json').click()]);
  expect(json.suggestedFilename()).toMatch(/^interview-story_yuki_\d{8}-\d{4}\.json$/);
  const exported = JSON.parse(await readDownload(json)) as { app: string; format: number; record: typeof record };
  expect(exported.app).toBe('interview-story');
  expect(exported.format).toBe(1);
  expect(exported.record.id).toBe(record.id);
  expect(exported.record.ending).toBe(record.ending);
  expect(exported.record.transcript).toHaveLength(record.transcript.length);

  // ── Try again: Setup opens on step 3, prefilled with this interview's options ──
  await page.getByTestId('result-try-again').click();
  await expectScreen(page, 'screen-SetupScreen');
  await expect(page.getByTestId('device-check')).toBeVisible();
  await expect(page.getByText('已按上一次面试的设置填写完毕')).toBeVisible();
  await expect(page.getByTestId('opt-questions')).toHaveValue('3');
  await expect(page.getByTestId('opt-followups').getByRole('radio', { name: '1 次' })).toHaveAttribute('aria-checked', 'true');

  // ── Records ──
  await page.getByTestId('menu-back').click();
  await expectScreen(page, 'screen-TitleScreen');
  await expect(page.getByTestId('title-continue')).toBeDisabled();
  await page.getByTestId('title-records').click();
  await expectScreen(page, 'screen-RecordsScreen');
  await expect(page.getByTestId('records-stats')).toContainText('1 场面试');
  const card = page.getByTestId(`record-${record.id}`);
  await expect(card).toContainText(String(Math.round(record.finalScore)));
  await card.click();
  await expectScreen(page, 'screen-ResultScreen');
  await expect(page.getByTestId('screen-ResultScreen')).toHaveAttribute('data-view', 'report');
  await expect(page.getByTestId('result-toast')).toHaveCount(0);
  await page.getByTestId('result-back-source').click();
  await expectScreen(page, 'screen-RecordsScreen');

  // ── Endings gallery ──
  await page.getByTestId('menu-back').click();
  await page.getByTestId('title-gallery').click();
  await expectScreen(page, 'screen-GalleryScreen');
  await expect(page.getByTestId('gal-progress')).toContainText('1 / 12');
  const cell = page.getByTestId(`gal-cell-yuki-${record.ending}`);
  await expect(cell).toHaveRole('button');
  for (const other of ['perfect', 'offer', 'pending', 'rejected'].filter((e) => e !== record.ending)) {
    await expect(page.getByTestId(`gal-cell-yuki-${other}`)).not.toHaveRole('button');
  }
  await cell.click();
  await page.getByTestId('gal-view-report').click();
  await expectScreen(page, 'screen-ResultScreen');
  await expect(page.getByTestId('result-back-source')).toHaveText('返回结局回廊');
  await page.getByTestId('result-back-source').click();
  await expectScreen(page, 'screen-GalleryScreen');

  // ── Deleting the record (with confirmation) keeps the unlocked ending ──
  await page.getByTestId('menu-back').click();
  await page.getByTestId('title-records').click();
  await page.getByTestId(`record-${record.id}-delete`).click();
  await page.getByTestId(`record-${record.id}-delete-yes`).click();
  await expect(page.getByTestId('records-empty')).toBeVisible();
  const after = await game(page);
  expect(after.records).toHaveLength(0);
  expect(Object.keys(after.endings)).toEqual([`yuki:${record.ending}`]);
});
