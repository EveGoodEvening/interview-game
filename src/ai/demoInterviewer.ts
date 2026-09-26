/**
 * Offline scripted interviewer (the game's default). Fully local, both languages, all three
 * personas. See ./demo/* for résumé reading, planning, turns and the report.
 */
import { LlmError } from '../llm/types';
import type { InterviewerAI } from '../types';
import { buildDemoPlan } from './demo/planner';
import { createRng, randomSeed } from './demo/random';
import { buildDemoReport } from './demo/report';
import { demoNextTurn } from './demo/turns';

let demoDelayMs = 600;

/** Artificial "thinking" delay for the demo interviewer (default ~600 ms; 0 in tests). */
export function setDemoDelay(ms: number): void {
  demoDelayMs = Math.max(0, ms);
}

export function getDemoDelay(): number {
  return demoDelayMs;
}

function abortError(): LlmError {
  return new LlmError('aborted', 'Request aborted');
}

/** Resolve after `ms` (±25 % jitter), rejecting with LlmError('aborted') if the signal fires. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (ms <= 0) return Promise.resolve();
  const jittered = Math.round(ms * (0.75 + Math.random() * 0.5));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, jittered);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface DemoInterviewerOptions {
  /** Seed for the plan (topic selection, phrasing). Defaults to a random seed per session. */
  seed?: number;
}

export function createDemoInterviewer(opts: DemoInterviewerOptions = {}): InterviewerAI {
  return {
    isDemo: true,
    async prepare(config, character, signal) {
      await wait(demoDelayMs * 2, signal);
      return buildDemoPlan(config, character, createRng(opts.seed ?? randomSeed()));
    },
    async nextTurn(ctx, signal) {
      await wait(demoDelayMs, signal);
      return demoNextTurn(ctx);
    },
    async evaluate(ctx, signal) {
      await wait(demoDelayMs * 2, signal);
      return buildDemoReport(ctx);
    },
  };
}
