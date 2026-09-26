/**
 * Localized, actionable copy for speech-recognition failures in the answer panel.
 *
 * The speech module reports a coarse `SttError.code`; API failures also carry the HTTP status
 * (`SttError.status`, and "HTTP 429" in the English message). Here that becomes the precise reason
 * the player can act on — wait (rate limit), fix the key (auth), fix the URL / model (404), retry
 * later (server), check the relay / URL (network) — plus engine-specific advice: the browser
 * recognizer's "network" error is about Chrome needing Google's servers, the API engine's is about
 * the endpoint or the relay.
 */
import type { SttError, SttErrorCode } from '../../speech';
import type { SttEngineKind } from '../../types';

const KNOWN_CODES: readonly SttErrorCode[] = ['not-supported', 'permission-denied', 'no-microphone', 'no-speech', 'network', 'api', 'aborted', 'config'];

/** HTTP status mentioned in an error message ("HTTP 429", "status 503"), if any. */
export function httpStatusOf(message: string): number | null {
  const m = /\b(?:HTTP|status)\s*:?\s*(\d{3})\b/i.exec(message);
  return m ? Number(m[1]) : null;
}

export interface SttErrorCopy {
  /** i18n key (namespace included). */
  key: string;
  vars: Record<string, string | number>;
}

/** Which localized message explains `err` for the engine in use. */
export function sttErrorCopy(err: Pick<SttError, 'code' | 'message'> & { status?: number }, engine: SttEngineKind): SttErrorCopy {
  const status = err.status ?? httpStatusOf(err.message);
  if (status !== null && status >= 400 && (err.code === 'api' || err.code === 'config' || err.code === 'network')) {
    if (status === 429) return { key: 'interview.stt.rateLimit', vars: { status } };
    if (status === 401 || status === 403) return { key: 'interview.stt.auth', vars: { status } };
    if (status === 404) return { key: 'interview.stt.notFound', vars: { status } };
    if (status >= 500) return { key: 'interview.stt.server', vars: { status } };
    return { key: 'interview.stt.badRequest', vars: { status } };
  }
  if (err.code === 'network' && engine === 'api') {
    return { key: /\bin time\b|timed?[ -]?out/i.test(err.message) ? 'interview.stt.apiTimeout' : 'interview.stt.apiNetwork', vars: {} };
  }
  const code = KNOWN_CODES.includes(err.code) ? err.code : 'api';
  return { key: `interview.stt.${code}`, vars: {} };
}
