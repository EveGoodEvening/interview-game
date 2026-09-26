/**
 * `test` with an automatic console guard: any `console.error` or uncaught page error during a test
 * fails it (React warnings, failed chunk loads, crashes in effects…). Tests that provoke an error on
 * purpose whitelist it with `consoleGuard.allow(/pattern/)`.
 */
import { test as base, expect } from '@playwright/test';

export interface ConsoleGuard {
  allow(pattern: RegExp): void;
}

export const test = base.extend<{ consoleGuard: ConsoleGuard }>({
  consoleGuard: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const allowed: RegExp[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
        else if (msg.type() === 'warning') warnings.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(`Uncaught ${err.name}: ${err.message}`));
      await use({ allow: (pattern) => allowed.push(pattern) });
      if (warnings.length) {
        await testInfo.attach('console-warnings', { body: warnings.join('\n'), contentType: 'text/plain' });
        if (process.env.E2E_WARNINGS) console.log(`[${testInfo.title}] console warnings:\n  ${warnings.join('\n  ')}`);
      }
      const unexpected = errors.filter((e) => !allowed.some((re) => re.test(e)));
      expect(unexpected, 'unexpected console errors / page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
