import { describe, expect, it } from 'vitest';
import { translate } from '../../i18n';
import type { Lang } from '../../types';
import { chapterLabel, errorCopy, ERROR_CODES, formatClock, friendlyErrorCode, progressLabel, settingsLabelVars, zhNumeral } from './labels';
import { pagesForEntry } from './useLinePlayer';

const tr = (lang: Lang) => (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars);

describe('zhNumeral', () => {
  it('writes Chinese numerals', () => {
    expect([1, 2, 9, 10, 11, 12, 20, 21, 99].map(zhNumeral)).toEqual(['一', '二', '九', '十', '十一', '十二', '二十', '二十一', '九十九']);
    expect(zhNumeral(100)).toBe('100');
  });
});

describe('chapterLabel', () => {
  it('builds Chinese chapter cards', () => {
    const t = tr('zh');
    expect(chapterLabel({ phase: 'intro', topicIndex: null, topicTitle: null }, t, 'zh').full).toBe('序章 · 初次见面');
    expect(chapterLabel({ phase: 'questioning', topicIndex: 1, topicTitle: '团队协作' }, t, 'zh').full).toBe('第二幕 · 团队协作');
    expect(chapterLabel({ phase: 'questioning', topicIndex: 9, topicTitle: 'X' }, t, 'zh').head).toBe('第十幕');
    expect(chapterLabel({ phase: 'reverse', topicIndex: null, topicTitle: null }, t, 'zh').full).toBe('终章 · 反问时间');
    expect(chapterLabel({ phase: 'closing', topicIndex: null, topicTitle: null }, t, 'zh').full).toBe('尾声');
  });

  it('builds English chapter cards', () => {
    const t = tr('en');
    expect(chapterLabel({ phase: 'intro', topicIndex: null, topicTitle: null }, t, 'en').head).toBe('Prologue');
    const act = chapterLabel({ phase: 'questioning', topicIndex: 2, topicTitle: 'Performance budgets' }, t, 'en');
    expect(act.full).toBe('Act 3 · Performance budgets');
    expect(act.kicker).toBe('Chapter 3');
    expect(chapterLabel({ phase: 'reverse', topicIndex: null, topicTitle: null }, t, 'en').full).toBe('Finale · Your Questions');
    expect(chapterLabel({ phase: 'closing', topicIndex: null, topicTitle: null }, t, 'en').full).toBe('Epilogue');
  });

  it('copes with a missing topic title', () => {
    expect(chapterLabel({ phase: 'questioning', topicIndex: 0, topicTitle: null }, tr('zh'), 'zh').full).toBe('第一幕');
  });
});

describe('progressLabel', () => {
  const base = { mainIndex: 2, mainTotal: 5, isFollowUp: false, topicTitle: '项目深挖' };
  it('shows the phase-specific chip', () => {
    const t = tr('zh');
    expect(progressLabel({ ...base, phase: 'intro' }, t).main).toBe('序章');
    expect(progressLabel({ ...base, phase: 'questioning' }, t)).toEqual({ main: 'Q2/5', badge: null, topic: '项目深挖' });
    expect(progressLabel({ ...base, phase: 'questioning', isFollowUp: true }, t).badge).toBe('追问');
    expect(progressLabel({ ...base, phase: 'reverse' }, t).main).toBe('反问');
    expect(progressLabel({ ...base, phase: 'closing' }, t).main).toBe('尾声');
    expect(progressLabel({ ...base, phase: 'questioning', isFollowUp: true }, tr('en')).badge).toBe('Follow-up');
  });
});

describe('error copy', () => {
  it('maps unknown codes to "unknown"', () => {
    expect(friendlyErrorCode('network')).toBe('network');
    expect(friendlyErrorCode('weird_code')).toBe('unknown');
  });

  it('has a title, message and hint for every code in both languages', () => {
    for (const lang of ['zh', 'en'] as const) {
      for (const code of ERROR_CODES) {
        const copy = errorCopy(code, tr(lang));
        for (const text of [copy.title, copy.message, copy.hint]) expect(text).not.toMatch(/^interview\./);
      }
    }
    expect(errorCopy('network', tr('en')).hint).toMatch(/relay/i);
  });

  it('points the hints at Config tabs and switches that really exist (no placeholders left)', () => {
    for (const lang of ['zh', 'en'] as const) {
      const t = tr(lang);
      for (const code of ERROR_CODES) expect(errorCopy(code, t).hint).not.toMatch(/\{\w+\}/);
      // The real tab label ("AI 模型" / "AI Model") and relay switch ("使用本地中转" / "Use local relay").
      expect(errorCopy('network', t).hint).toContain(t('settings.tab.llm'));
      expect(errorCopy('network', t).hint).toContain(t('settings.llm.proxy'));
      expect(errorCopy('config', t).hint).toContain(t('settings.tab.llm'));
    }
    expect(errorCopy('network', tr('zh')).hint).toContain('设置 → AI 模型');
    expect(errorCopy('network', tr('en')).hint).toContain('Config → AI Model');
    expect(errorCopy('config', tr('zh')).hint).not.toContain('大模型');
  });

  it('speech hints in the interview namespace name the real Voice tab', () => {
    for (const lang of ['zh', 'en'] as const) {
      const t = tr(lang);
      const voiceTab = t('settings.tab.voice');
      for (const key of ['interview.stt.config', 'interview.stt.not-supported', 'interview.answer.fallbackHint', 'interview.stt.apiNetwork']) {
        const text = t(key, settingsLabelVars(t));
        expect(text).toContain(voiceTab);
        expect(text).not.toMatch(/\{\w+\}/);
      }
    }
  });
});

describe('formatClock', () => {
  it('formats mm:ss', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(59.9)).toBe('00:59');
    expect(formatClock(125)).toBe('02:05');
    expect(formatClock(-3)).toBe('00:00');
  });
});

describe('pagesForEntry', () => {
  it('falls back to the raw text and never hands a closing turn to the answer panel', () => {
    expect(pagesForEntry({ id: 'a', role: 'interviewer', text: 'Hello there?', at: 0 })).toEqual([{ index: 0, text: 'Hello there?', part: 'question', isQuestion: true }]);
    const closing = pagesForEntry({
      id: 'b',
      role: 'interviewer',
      text: 'Bye!',
      at: 0,
      turn: { kind: 'closing', reaction: '', question: 'Thanks for coming, goodbye!', expression: 'smile', topicIndex: null, assessment: null },
    });
    expect(closing.every((p) => !p.isQuestion)).toBe(true);
  });
});
