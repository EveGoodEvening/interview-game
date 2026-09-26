import { describe, expect, it } from 'vitest';
import { ResumeParseError, type ResumeErrorReason, type ResumeParseErrorCode } from './errors';
import {
  describeResumeError,
  describeResumeWarning,
  formatResumeWarning,
  parseResumeWarning,
  RESUME_WARNING,
  type ResumeWarningCode,
} from './warnings';

const SAMPLE_DETAIL: Record<ResumeWarningCode, string> = {
  truncated: '23456',
  little_text: '42',
  scanned_pages: '2',
  pages_limited: '20/31',
  page_errors: '1',
  encoding: 'gb18030',
  replacement_chars: '7',
};

describe('résumé warnings', () => {
  it('round-trips code and detail', () => {
    expect(formatResumeWarning(RESUME_WARNING.truncated, 23456)).toBe('truncated:23456');
    expect(formatResumeWarning(RESUME_WARNING.littleText)).toBe('little_text');
    expect(parseResumeWarning('pages_limited:20/31')).toEqual({ code: 'pages_limited', detail: '20/31' });
    expect(parseResumeWarning('little_text')).toEqual({ code: 'little_text', detail: '' });
    expect(parseResumeWarning('Something else: happened')).toBeNull();
  });

  it.each(Object.entries(SAMPLE_DETAIL))('describes %s in both languages', (code, detail) => {
    const warning = `${code}:${detail}`;
    const zh = describeResumeWarning(warning, 'zh');
    const en = describeResumeWarning(warning, 'en');
    expect(zh).not.toBe(warning);
    expect(en).not.toBe(warning);
    expect(zh).toMatch(/[\u4E00-\u9FFF]/);
    expect(en).not.toMatch(/[\u4E00-\u9FFF]/);
  });

  it('formats numbers and details', () => {
    expect(describeResumeWarning('truncated:23456', 'en')).toContain('23,456');
    expect(describeResumeWarning('pages_limited:20/31', 'zh')).toContain('31');
    expect(describeResumeWarning('encoding:gb18030', 'zh')).toContain('GBK');
  });

  it('passes unknown warnings through verbatim', () => {
    expect(describeResumeWarning('custom note', 'zh')).toBe('custom note');
  });
});

describe('describeResumeError', () => {
  const codes: ResumeParseErrorCode[] = ['unsupported', 'empty', 'too_large', 'corrupt'];
  const reasons: ResumeErrorReason[] = [
    'legacy_doc',
    'image',
    'binary',
    'other_document',
    'wrong_format',
    'encrypted',
    'no_text',
    'timeout',
    'engine',
    'read_failed',
  ];

  it('has a message for every code and reason in both languages', () => {
    for (const code of codes) {
      for (const reason of [undefined, ...reasons]) {
        const error = new ResumeParseError(code, 'x', reason ? { reason } : undefined);
        expect(describeResumeError(error, 'zh')).toMatch(/[\u4E00-\u9FFF]/);
        expect(describeResumeError(error, 'en')).toMatch(/^[^\u4E00-\u9FFF]+$/);
      }
    }
  });

  it('prefers the specific reason', () => {
    const error = new ResumeParseError('unsupported', 'x', { reason: 'legacy_doc' });
    expect(describeResumeError(error, 'en')).toContain('.doc');
  });

  it('falls back to a generic message for unexpected errors', () => {
    expect(describeResumeError(new Error('boom'), 'en')).toBe(describeResumeError(new ResumeParseError('corrupt', 'x'), 'en'));
  });

  it('keeps the error contract (name, code, reason, cause)', () => {
    const cause = new Error('inner');
    const error = new ResumeParseError('corrupt', 'outer', { reason: 'timeout', cause });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'ResumeParseError', code: 'corrupt', reason: 'timeout', message: 'outer', cause });
    expect(new ResumeParseError('empty', 'm').reason).toBeUndefined();
  });
});
