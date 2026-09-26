import { describe, expect, it } from 'vitest';
import { countContentChars, normalizeResumeText, truncateResumeText } from './normalize';
import { SAMPLE_RESUMES } from './samples';

/** Build strings with invisible/special characters without escape sequences in source. */
const ch = (...codes: number[]) => String.fromCodePoint(...codes);

describe('normalizeResumeText', () => {
  it('unifies line endings and trims trailing spaces', () => {
    expect(normalizeResumeText('a  \r\nb\rc\t \n')).toBe('a\nb\nc');
  });

  it('collapses runs of blank lines to a single blank line', () => {
    expect(normalizeResumeText('\n\n\nTitle\n\n\n\n\nBody\n \n\t\nEnd\n\n')).toBe('Title\n\nBody\n\nEnd');
  });

  it('turns exotic spaces into spaces and collapses long runs inside a line to two', () => {
    const nbsp = ch(0xa0);
    const ideographic = ch(0x3000);
    expect(normalizeResumeText(`Java${nbsp}${nbsp}${nbsp}${nbsp}Go${ideographic}Redis\tKafka`)).toBe('Java  Go Redis Kafka');
  });

  it('removes zero-width, soft hyphen, control and icon-font characters', () => {
    const input = `Zh${ch(0x200b)}ang${ch(0xad)} ${ch(0xfeff)}San${ch(0x7)}${ch(0xe900)} 138`;
    expect(normalizeResumeText(input)).toBe('Zhang San 138');
  });

  it('unifies every bullet style to "- "', () => {
    const input = [
      '• one',
      '●two',
      '▪ three',
      '➢ four',
      '· five',
      '* six',
      '– seven',
      `${ch(0xf0b7)} eight`,
      '  - nested',
    ].join('\n');
    expect(normalizeResumeText(input)).toBe(
      ['- one', '- two', '- three', '- four', '- five', '- six', '- seven', '- eight', '  - nested'].join('\n'),
    );
  });

  it('leaves non-bullet punctuation alone', () => {
    const input = '**Bold heading**\n---\n1. first\n-1 is a number\nJava • Go • Redis';
    expect(normalizeResumeText(input)).toBe(input);
  });

  it('caps indentation at 4 spaces', () => {
    expect(normalizeResumeText('top\n\t\t\t\tdeep')).toBe('top\n    deep');
  });

  it('folds Kangxi radicals, ligatures and full-width alphanumerics but keeps Chinese punctuation', () => {
    // U+2F64 KANGXI RADICAL USE → 用, U+FB01 ligature fi, full-width "ＧＰＡ：３．８／４"
    const input = `熟练使${ch(0x2f64)} Java，${ch(0xfb01)}nance ${ch(0xff27, 0xff30, 0xff21)}：${ch(0xff13, 0xff0e, 0xff18, 0xff0f, 0xff14)}（前 ${ch(0xff11, 0xff10, 0xff05)}）`;
    expect(normalizeResumeText(input)).toBe('熟练使用 Java，finance GPA：3.8/4（前 10%）');
  });

  it('is idempotent and keeps the sample résumés unchanged', () => {
    for (const lang of ['zh', 'en'] as const) {
      const text = SAMPLE_RESUMES[lang].text;
      expect(normalizeResumeText(text)).toBe(text);
      expect(normalizeResumeText(normalizeResumeText(text))).toBe(text);
    }
  });
});

describe('truncateResumeText', () => {
  it('returns short text unchanged', () => {
    expect(truncateResumeText('hello', 10)).toEqual({ text: 'hello', truncated: false, originalLength: 5 });
  });

  it('cuts at a line break near the limit', () => {
    const text = `${'a'.repeat(95)}\n${'b'.repeat(50)}`;
    const result = truncateResumeText(text, 100);
    expect(result).toEqual({ text: 'a'.repeat(95), truncated: true, originalLength: 146 });
  });

  it('hard-cuts when there is no nearby line break and never splits a surrogate pair', () => {
    const emoji = ch(0x1f600);
    const text = 'x'.repeat(9) + emoji + 'y'.repeat(20);
    const result = truncateResumeText(text, 10); // the 10th code unit is the high surrogate
    expect(result.truncated).toBe(true);
    expect(result.text).toBe('x'.repeat(9));
    expect(result.text.length).toBeLessThanOrEqual(10);
  });
});

describe('countContentChars', () => {
  it('ignores whitespace', () => {
    expect(countContentChars(' a b\n\tc 中 ')).toBe(4);
  });
});
