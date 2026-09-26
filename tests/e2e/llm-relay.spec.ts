/**
 * 3 · The real LLM path: a mock OpenAI-compatible server (support/mockLlm.ts) configured through
 * Config → AI as "Custom (OpenAI-compatible)" with the local relay ON. Requests must leave the
 * browser as /api/proxy/… with the relay header, reach the mock with the Authorization header and
 * `response_format: json_object`, and an interview must run to the result. Error path: a 401 shows
 * the localized auth dialog; after the "key is fixed" Retry carries on.
 */
import { type Page, type Request } from '@playwright/test';
import { expect, test } from './support/test';
import { advanceInterviewer, expectScreen, game, openTitle, pendingTurnKind, seedSettings, FAST_SETTINGS, setupInterview, startInterview, typeAnswer } from './support/app';
import { startMockLlm, type MockLlm } from './support/mockLlm';

/** 5450–5458 (5459 is the production smoke server). */
const MOCK_PORTS = [5450, 5451, 5452, 5453, 5454, 5455, 5456, 5457, 5458];
const API_KEY = 'sk-e2e-mock-key';
const MODEL = 'mock-model';

let mock: MockLlm;

test.beforeAll(async () => {
  mock = await startMockLlm(MOCK_PORTS, API_KEY);
});
test.afterAll(async () => {
  await mock?.close();
});
test.beforeEach(() => {
  mock.requests.length = 0;
  mock.succeed();
});

/** Record every browser request aimed at the mock (directly or through the relay). */
function trackLlmRequests(page: Page): Request[] {
  const seen: Request[] = [];
  page.on('request', (r) => {
    if (r.url().includes(`127.0.0.1:${mock.port}`)) seen.push(r);
  });
  return seen;
}

/** Config → AI: Custom (OpenAI-compatible), base URL, key, model; the relay is on by default. */
async function fillCustomLlm(page: Page, apiKey: string): Promise<void> {
  await expectScreen(page, 'screen-SettingsScreen');
  await expect(page.getByRole('tab', { name: /AI 模型/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('llm-preset').selectOption('custom-openai');
  await page.getByTestId('llm-base').fill(mock.baseUrl);
  await page.getByTestId('llm-key').fill(apiKey);
  await page.getByTestId('llm-model').fill(MODEL);
  const relay = page.getByTestId('llm-proxy');
  await expect(relay).toBeEnabled();
  await expect(relay).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('settings-llm')).toContainText('已就绪');
}

/** Title → Config → AI with the right key; fetch the model list and test the connection. */
async function configureCustomLlm(page: Page): Promise<void> {
  await page.getByTestId('title-config').click();
  await fillCustomLlm(page, API_KEY);

  // "Fetch models" goes through the relay too.
  await page.getByTestId('llm-fetch-models').click();
  await expect(page.getByText('获取到 2 个模型')).toBeVisible();

  await page.getByTestId('llm-test').click();
  const result = page.getByTestId('llm-test-result');
  await expect(result).toContainText('连接成功！');
  await expect(result).toContainText('回复：OK');
  await page.getByTestId('menu-back').click();
  await expectScreen(page, 'screen-TitleScreen');
}

test('custom OpenAI-compatible provider through the local relay runs an interview to the result', async ({ page }) => {
  const browserRequests = trackLlmRequests(page);
  await seedSettings(page, FAST_SETTINGS);
  await openTitle(page);
  await configureCustomLlm(page);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('igg.settings.v1') ?? '{}').state.settings.llm);
  expect(stored).toMatchObject({ presetId: 'custom-openai', protocol: 'openai', baseUrl: mock.baseUrl, apiKey: API_KEY, model: MODEL, useProxy: true });

  await page.getByTestId('title-new').click();
  await setupInterview(page, { questions: 'min', followUps: 0 });
  const device = page.getByTestId('device-check');
  await expect(device).toContainText('已就绪');
  await expect(device).toContainText(MODEL);
  await page.getByTestId('device-llm-test').click();
  await expect(device).toContainText('连接成功');
  await startInterview(page);

  let answers = 0;
  for (let turn = 0; turn < 20; turn++) {
    const state = await advanceInterviewer(page);
    if (state.screen === 'result') break;
    expect(state.kind).toBe('answer');
    const kind = await pendingTurnKind(page);
    if (kind === 'reverse_answer') {
      await page.getByTestId('answer-end-reverse').click();
      await expect(page.getByTestId('answer-panel')).toBeHidden();
    } else {
      await typeAnswer(page, `第 ${++answers} 个回答：首先我分析了瓶颈，然后重构了服务，结果延迟下降了 60%。`);
    }
  }
  await expectScreen(page, 'screen-ResultScreen');
  await page.getByTestId('result-to-report').click();
  await expect(page.getByTestId('report-view')).toContainText('模拟大模型给出的总评');
  const { lastRecord } = await game(page);
  expect(lastRecord!.transcript[0].text).toContain('模拟大模型已经读完你的简历');

  // ── Browser side: only relayed requests, each with the relay header and the API key ──
  expect(browserRequests.length).toBeGreaterThan(0);
  for (const r of browserRequests) {
    expect(new URL(r.url()).pathname).toMatch(new RegExp(`^/api/proxy/http/127\\.0\\.0\\.1:${mock.port}/v1/(chat/completions|models)$`));
    expect(new URL(r.url()).port).toBe('5199');
    const headers = await r.allHeaders();
    expect(headers['x-interview-proxy']).toBe('1');
    expect(headers.authorization).toBe(`Bearer ${API_KEY}`);
  }

  // ── Mock side: the relay forwarded auth + JSON mode, and every interview step was an LLM call ──
  const kinds = mock.requests.map((r) => r.kind);
  expect(kinds).toEqual(expect.arrayContaining(['models', 'test', 'plan', 'turn', 'report']));
  expect(kinds).not.toContain('other');
  for (const r of mock.requests) {
    expect(r.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(r.headers['x-interview-proxy'], 'the relay strips its own header').toBeUndefined();
  }
  for (const r of mock.requests.filter((q) => ['plan', 'turn', 'report'].includes(q.kind))) {
    expect(r.url).toBe('/v1/chat/completions');
    expect(r.body).toMatchObject({ model: MODEL, response_format: { type: 'json_object' } });
  }
  // Every browser chat request reached the mock exactly once (no silent retries).
  const chats = browserRequests.filter((r) => r.url().endsWith('/chat/completions')).length;
  expect(mock.requests.filter((r) => r.url.endsWith('/chat/completions'))).toHaveLength(chats);
});

test('a wrong key: localized auth errors, fixed from the error dialog, then Retry carries on', async ({ page, consoleGuard }) => {
  // Chrome logs every failed HTTP response; these are provoked on purpose.
  consoleGuard.allow(/status of (401 \(Unauthorized\)|503 \(Service Unavailable\))/);
  await seedSettings(page, FAST_SETTINGS);
  await openTitle(page);

  // A mistyped key: the connection test already says so.
  await page.getByTestId('title-config').click();
  await fillCustomLlm(page, 'sk-wrong-key');
  await page.getByTestId('llm-test').click();
  await expect(page.getByTestId('llm-test-result')).toContainText('连接失败');
  await expect(page.getByTestId('llm-test-result')).toContainText('API Key 无效或没有权限（401/403）');
  await page.getByTestId('menu-back').click();

  await page.getByTestId('title-new').click();
  await setupInterview(page, { questions: 'min', followUps: 0 });
  await startInterview(page);

  const dialog = page.getByRole('dialog', { name: /API Key 无效/ });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('error-dialog')).toHaveAttribute('data-code', 'auth');
  await expect(dialog).toContainText('服务商拒绝了请求（401/403）');
  await dialog.getByText('技术细节').click();
  await expect(dialog).toContainText('[auth]');
  expect((await game(page)).stage).toMatchObject({ kind: 'error', code: 'auth', retry: 'prepare' });
  const failedPlans = mock.requests.filter((r) => r.kind === 'plan').length;
  expect(failedPlans).toBeGreaterThanOrEqual(1);

  // "打开设置" opens Config on the AI tab; fix the key and come back to the (still failed) interview.
  await dialog.getByRole('button', { name: '打开设置' }).click();
  await page.getByTestId('llm-key').fill(API_KEY);
  await page.getByTestId('menu-back').click();
  await expectScreen(page, 'screen-InterviewScreen');
  await expect(dialog).toBeVisible();

  // Retry re-runs exactly the failed step with the new settings.
  await page.getByTestId('error-retry').click();
  await expect(dialog).toBeHidden();
  const state = await advanceInterviewer(page);
  expect(state.kind).toBe('answer');
  await expect(page.getByTestId('question-card')).toContainText('先请你做个简单的自我介绍吧');
  const plans = mock.requests.filter((r) => r.kind === 'plan');
  expect(plans).toHaveLength(failedPlans + 1);
  expect(plans.at(-1)!.headers.authorization).toBe(`Bearer ${API_KEY}`);
  expect((await game(page)).session!.transcript).toHaveLength(1);

  // A provider outage mid-interview: the turn fails with the server message and Retry resumes it.
  mock.failWith(503);
  await page.getByTestId('answer-textarea').fill('我叫张晓明，做过三年后端开发，主导过订单服务重构。');
  await page.getByTestId('answer-textarea').press('Control+Enter');
  const outage = page.getByRole('dialog', { name: /服务暂时不可用/ });
  await expect(outage).toBeVisible();
  expect((await game(page)).stage).toMatchObject({ kind: 'error', code: 'server', retry: 'turn' });
  mock.succeed();
  await page.getByTestId('error-retry').click();
  await expect(outage).toBeHidden();
  expect((await advanceInterviewer(page)).kind).toBe('answer');
  const { session } = await game(page);
  expect(session!.transcript.filter((e) => e.role === 'candidate')).toHaveLength(1);
  expect(session!.transcript.at(-1)!.turn!.kind).toBe('main');
});
