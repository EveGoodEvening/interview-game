import { describe, expect, it } from 'vitest';
import { allKeys, translate } from './index';

describe('i18n', () => {
  it('zh and en define the same keys', () => {
    const zh = new Set(allKeys('zh'));
    const en = new Set(allKeys('en'));
    expect([...zh].filter((k) => !en.has(k))).toEqual([]);
    expect([...en].filter((k) => !zh.has(k))).toEqual([]);
  });

  it('falls back to the key and interpolates', () => {
    expect(translate('zh', 'nope.missing')).toBe('nope.missing');
    expect(translate('en', 'nope.{n}', { n: 3 })).toBe('nope.3');
  });
});
