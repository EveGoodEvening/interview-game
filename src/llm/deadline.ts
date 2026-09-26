/**
 * One abort signal per logical request that combines the caller's AbortSignal with an
 * overall timeout, and remembers which of the two fired so errors can be classified
 * as 'aborted' vs 'timeout'. Retries inside a request share the same deadline, so the
 * caller's `timeoutMs` bounds the whole call.
 */
import { LlmError } from './types';

export const DEFAULT_TIMEOUT_MS = 120_000;

export interface Deadline {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  /** True once the timeout (not the caller) aborted the request. */
  readonly timedOut: boolean;
  /** LlmError('timeout' | 'aborted') describing why the signal fired. */
  abortError(cause?: unknown): LlmError;
  /** Clear the timer and detach from the caller's signal. Always call when done. */
  dispose(): void;
}

export function createDeadline(external: AbortSignal | undefined, timeoutMs: number = DEFAULT_TIMEOUT_MS): Deadline {
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => controller.abort(external?.reason);
  if (external?.aborted) controller.abort(external.reason);
  else external?.addEventListener('abort', onExternalAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new LlmError('timeout', `Request timed out after ${ms} ms`));
  }, ms);

  return {
    signal: controller.signal,
    timeoutMs: ms,
    get timedOut() {
      return timedOut;
    },
    abortError(cause?: unknown) {
      return timedOut
        ? new LlmError('timeout', `Request timed out after ${ms} ms`, { cause })
        : new LlmError('aborted', 'Request was cancelled', { cause });
    },
    dispose() {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    },
  };
}

/** Wait `ms`, rejecting early with the deadline's abort error. */
export function sleep(ms: number, deadline: Deadline): Promise<void> {
  return new Promise((resolve, reject) => {
    if (deadline.signal.aborted) {
      reject(deadline.abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(deadline.abortError());
    };
    const timer = setTimeout(() => {
      deadline.signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    deadline.signal.addEventListener('abort', onAbort, { once: true });
  });
}
