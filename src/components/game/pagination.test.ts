import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_UNITS, paginate, paginateTurn, splitSentences, textUnits } from './pagination';

describe('textUnits', () => {
  it('counts CJK as 1 and Latin as 0.5', () => {
    expect(textUnits('你好')).toBe(2);
    expect(textUnits('hi')).toBe(1);
    expect(textUnits('你好 hi。')).toBe(2 + 0.5 + 1 + 1);
  });
});

describe('splitSentences', () => {
  it('splits Chinese on 。！？ and keeps closing quotes', () => {
    expect(splitSentences('你好！我是林小雪。你准备好了吗？「好的。」嗯')).toEqual(['你好！', '我是林小雪。', '你准备好了吗？', '「好的。」', '嗯']);
  });

  it('keeps runs of terminal punctuation together', () => {
    expect(splitSentences('真的吗？！太棒了……那我们开始吧。')).toEqual(['真的吗？！', '太棒了……', '那我们开始吧。']);
    expect(splitSentences('Really?! Well... okay.')).toEqual(['Really?!', 'Well...', 'okay.']);
  });

  it('does not split decimals, dotted names, initials or abbreviations', () => {
    expect(splitSentences('We shipped v2.5 with Node.js in the U.S. market, e.g. Dr. Smith liked it. Next!')).toEqual([
      'We shipped v2.5 with Node.js in the U.S. market, e.g. Dr. Smith liked it.',
      'Next!',
    ]);
  });

  it('splits on semicolons', () => {
    expect(splitSentences('First part; second part.')).toEqual(['First part;', 'second part.']);
  });
});

describe('paginate', () => {
  it('returns [] for blank text', () => {
    expect(paginate('')).toEqual([]);
    expect(paginate('  \n  ')).toEqual([]);
  });

  it('merges short sentences into one page', () => {
    expect(paginate('嗯嗯。原来如此。那我们继续吧。')).toEqual(['嗯嗯。原来如此。那我们继续吧。']);
    expect(paginate('I see. That makes sense. Let us continue.')).toEqual(['I see. That makes sense. Let us continue.']);
  });

  it('treats newlines as hard page breaks', () => {
    expect(paginate('第一行。\n第二行。')).toEqual(['第一行。', '第二行。']);
  });

  it('keeps every page within the CJK limit and loses no text', () => {
    const text = '你好，欢迎来到星辰科技的面试。我是今天的面试官林小雪，很高兴认识你。在开始之前，我想先简单介绍一下今天的流程：我们会先聊聊你的经历，然后针对你简历上的几个项目深入交流一下，最后留一些时间给你提问。请不要紧张，就像平时聊天一样就好。';
    const pages = paginate(text);
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) expect(textUnits(p)).toBeLessThanOrEqual(DEFAULT_PAGE_UNITS);
    expect(pages.join('')).toBe(text);
  });

  it('keeps every page within ~140 Latin chars and never splits words', () => {
    const text =
      'Thanks for walking me through that migration. It sounds like you owned the rollout end to end, which is great. ' +
      'I am curious about the decision itself: when you chose to move the checkout service from the monolith to a separate deployment, ' +
      'what alternatives did you seriously consider, and what data convinced you that the extra operational cost was worth it?';
    const pages = paginate(text);
    const words = new Set(text.split(/\s+/));
    for (const p of pages) {
      expect(p.length).toBeLessThanOrEqual(140);
      for (const w of p.split(/\s+/)) expect(words.has(w)).toBe(true);
    }
    expect(pages.join(' ')).toBe(text);
  });

  it('splits a single over-long sentence at clauses, balanced', () => {
    const text = '我注意到你在上一段实习中负责了订单系统的重构，并且把接口的平均响应时间从八百毫秒降到了两百毫秒，同时还推动团队建立了完善的监控告警体系，让线上故障的平均发现时间缩短到了五分钟以内';
    const pages = paginate(text);
    expect(pages.length).toBe(2);
    expect(pages.join('')).toBe(text);
    const [a, b] = pages.map(textUnits);
    expect(Math.abs(a - b)).toBeLessThan(30);
  });

  it('never cuts inside a Latin word when a CJK sentence has no punctuation', () => {
    const text = '我们用Kubernetes和PostgreSQL以及Elasticsearch搭建了一整套可观测平台' .repeat(3);
    const pages = paginate(text, { maxUnits: 30 });
    expect(pages.join('')).toBe(text);
    for (const p of pages) {
      expect(p).not.toMatch(/^[a-z]/); // would mean a word was cut in half
      expect(p).not.toMatch(/(Kube|Postgre|Elastic)$/);
    }
  });

  it('respects a custom page size', () => {
    const pages = paginate('一二三四五。六七八九十。甲乙丙丁戊。', { maxUnits: 10 });
    expect(pages).toEqual(['一二三四五。', '六七八九十。', '甲乙丙丁戊。']);
  });
});

describe('paginateTurn', () => {
  it('puts the reaction before the question and flags the last question page', () => {
    const pages = paginateTurn({ reaction: '嗯嗯，原来如此。', question: '那你能具体说说当时是怎么做的吗？' });
    expect(pages).toEqual([
      { index: 0, text: '嗯嗯，原来如此。', part: 'reaction', isQuestion: false },
      { index: 1, text: '那你能具体说说当时是怎么做的吗？', part: 'question', isQuestion: true },
    ]);
  });

  it('flags only the final page of a multi-page question', () => {
    const question = 'Imagine you joined us tomorrow and the checkout conversion suddenly dropped by twenty percent overnight. '.repeat(2) + 'What would you do first?';
    const pages = paginateTurn({ reaction: '', question });
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.filter((p) => p.isQuestion)).toHaveLength(1);
    expect(pages[pages.length - 1].isQuestion).toBe(true);
    expect(pages.every((p) => p.part === 'question')).toBe(true);
  });

  it('handles a closing turn without a question', () => {
    const pages = paginateTurn({ reaction: '今天就到这里，辛苦啦！', question: '' });
    expect(pages).toEqual([{ index: 0, text: '今天就到这里，辛苦啦！', part: 'reaction', isQuestion: false }]);
  });
});
