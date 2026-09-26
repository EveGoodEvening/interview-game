/**
 * 7 · Production smoke (project "prod"): `npm run build`, then `node server/index.ts` on port 5459.
 * The built game must load from the production server (entry + lazily loaded chunks + the pdf.js
 * worker), the relay's health endpoint must answer, and the dev-only hooks must be absent.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 5459;
const ORIGIN = `http://127.0.0.1:${PORT}`;

/** Run a command in the project root; resolves with its output, rejects with it on failure. */
function run(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0' } });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}\n${out.slice(-4000)}`));
    });
  });
}

/** Start the production server and wait until it listens. */
function startServer(): Promise<{ child: ChildProcess; log: () => string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server/index.ts'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' } });
    let out = '';
    const onData = (d: Buffer) => {
      out += d.toString();
      if (out.includes(`http://127.0.0.1:${PORT}`)) resolve({ child, log: () => out });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`server exited early (${code}):\n${out}`)));
  });
}

let server: { child: ChildProcess; log: () => string } | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await run('npm', ['run', 'build'], 200_000);
  server = await startServer();
});

test.afterAll(async () => {
  const child = server?.child;
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
});

test('production build is served by server/index.ts with a working relay', async ({ page, request }) => {
  const health = await request.get(`${ORIGIN}/api/health`);
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ ok: true, proxy: true });

  // The relay refuses requests that do not come from the game page.
  const forbidden = await request.get(`${ORIGIN}/api/proxy/http/127.0.0.1:${PORT}/api/health`);
  expect(forbidden.status()).toBe(403);

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(ORIGIN);
  await expect(page.getByTestId('screen-TitleScreen')).toBeVisible();
  await expect(page.getByRole('heading', { name: '面试物语' })).toBeVisible();
  await expect(page).toHaveTitle(/面试物语|Interview Story/);
  // Dev-only debugging hooks are compiled out of the production bundle.
  expect(await page.evaluate(() => ({ stores: '__stores' in window, demo: '__demo' in window }))).toEqual({ stores: false, demo: false });
  // The relay was detected by the page, so the Config toggle would be usable.
  await page.getByTestId('title-config').click();
  await expect(page.getByTestId('screen-SettingsScreen')).toBeVisible();
  await page.getByTestId('llm-preset').selectOption('deepseek');
  await expect(page.getByTestId('llm-proxy')).toBeEnabled();
  await page.getByTestId('llm-preset').selectOption('demo');
  await page.getByTestId('menu-back').click();

  // Lazily loaded screens and the pdf.js worker are served correctly (MIME types, SPA paths).
  await page.getByTestId('title-new').click();
  await expect(page.getByTestId('screen-SetupScreen')).toBeVisible();
  await page.getByTestId('setup-next').click();
  await page.getByTestId('resume-file').setInputFiles(fileURLToPath(new URL('../../src/resume/__fixtures__/simple.pdf', import.meta.url)));
  await expect(page.getByTestId('resume-text')).toHaveValue(/^Jane Doe/);
  await page.getByTestId('setup-next').click();
  await page.getByTestId('setup-next').click();
  await expect(page.getByTestId('screen-InterviewScreen')).toBeVisible();
  // The demo interviewer (a separate chunk) reads the résumé and asks for a self-introduction.
  await expect(page.getByTestId('screen-InterviewScreen')).toHaveAttribute('data-stage', /interviewer|answer/, { timeout: 20_000 });

  expect(errors).toEqual([]);
});
