import { describe, expect, it } from 'vitest';
import { translate } from '../../i18n';
import { SttError } from '../../speech';
import { settingsLabelVars } from './labels';
import { httpStatusOf, sttErrorCopy } from './sttErrors';

describe('sttErrorCopy', () => {
  it('reads the HTTP status from the error (field first, message as a fallback)', () => {
    expect(httpStatusOf('Transcription failed (HTTP 429): Rate limit reached')).toBe(429);
    expect(httpStatusOf('no status here')).toBeNull();
    expect(sttErrorCopy(new SttError('api', 'x', { status: 503 }), 'api').key).toBe('interview.stt.server');
    expect(sttErrorCopy(new SttError('api', 'Transcription failed (HTTP 429): slow down'), 'api')).toEqual({ key: 'interview.stt.rateLimit', vars: { status: 429 } });
  });

  it('gives the precise, actionable reason for API failures', () => {
    const copy = (code: SttError['code'], status?: number, message = 'x') => sttErrorCopy(new SttError(code, message, { status }), 'api').key;
    expect(copy('api', 429)).toBe('interview.stt.rateLimit');
    expect(copy('config', 401)).toBe('interview.stt.auth');
    expect(copy('config', 403)).toBe('interview.stt.auth');
    expect(copy('config', 404)).toBe('interview.stt.notFound');
    expect(copy('api', 500)).toBe('interview.stt.server');
    expect(copy('api', 413)).toBe('interview.stt.badRequest');
    expect(copy('network', undefined, 'Could not reach the transcription service: Failed to fetch.')).toBe('interview.stt.apiNetwork');
    expect(copy('network', undefined, 'The transcription service did not answer in time (timed out after 60s).')).toBe('interview.stt.apiTimeout');
    expect(copy('config')).toBe('interview.stt.config');
  });

  it("keeps the browser recognizer's Chrome/Google advice for its own network error only", () => {
    expect(sttErrorCopy(new SttError('network', 'network'), 'browser').key).toBe('interview.stt.network');
    expect(sttErrorCopy(new SttError('network', 'Failed to fetch'), 'api').key).toBe('interview.stt.apiNetwork');
    expect(translate('zh', 'interview.stt.apiNetwork')).not.toMatch(/Chrome|谷歌/);
  });

  it('every message exists in both languages with its placeholders filled', () => {
    const errors = [
      new SttError('api', 'x', { status: 429 }),
      new SttError('config', 'x', { status: 401 }),
      new SttError('config', 'x', { status: 404 }),
      new SttError('api', 'x', { status: 502 }),
      new SttError('api', 'x', { status: 400 }),
      new SttError('network', 'did not answer in time'),
      new SttError('network', 'Failed to fetch'),
      ...(['not-supported', 'permission-denied', 'no-microphone', 'no-speech', 'network', 'api', 'aborted', 'config'] as const).map((c) => new SttError(c, '')),
    ];
    for (const lang of ['zh', 'en'] as const) {
      const t = (k: string, v?: Record<string, string | number>) => translate(lang, k, v);
      for (const err of errors) {
        const { key, vars } = sttErrorCopy(err, 'api');
        const text = t(key, { ...settingsLabelVars(t), relay: t('settings.stt.proxy'), ...vars });
        expect(text).not.toBe(key);
        expect(text).not.toMatch(/\{\w+\}/);
      }
    }
  });
});
