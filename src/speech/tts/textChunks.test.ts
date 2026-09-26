import { describe, expect, it } from 'vitest';
import { cleanForSpeech, DEFAULT_CHUNK_WEIGHT, splitIntoChunks, splitSentences, textWeight } from './textChunks';

describe('textWeight', () => {
  it('counts CJK as 2 and Latin as 1', () => {
    expect(textWeight('abc')).toBe(3);
    expect(textWeight('你好')).toBe(4);
    expect(textWeight('React 很好')).toBe(10);
    expect(textWeight('，。')).toBe(4);
  });
});

describe('cleanForSpeech', () => {
  it('removes emoji, markdown marks and collapses whitespace', () => {
    expect(cleanForSpeech('**Great** job 👍🏻!  Let’s `go`')).toBe('Great job !  Let’s go'.replace(/ {2}/, ' '));
    expect(cleanForSpeech('## 标题\n内容  很好 ✨')).toBe('标题\n内容 很好');
  });

  it('keeps meaningful symbols like C# and 3.5', () => {
    expect(cleanForSpeech('I use C# and Python 3.5')).toBe('I use C# and Python 3.5');
  });
});

describe('splitSentences', () => {
  it('splits Chinese on 。！？；… and keeps closing quotes', () => {
    expect(splitSentences('你好。我是小雪！你呢？“真的吗？”好吧；嗯……那就这样')).toEqual([
      '你好。',
      '我是小雪！',
      '你呢？',
      '“真的吗？”',
      '好吧；',
      '嗯……',
      '那就这样',
    ]);
  });

  it('splits English on . ! ? but not inside numbers', () => {
    expect(splitSentences('Version 3.14 shipped. Great! Why? "Yes." Next')).toEqual([
      'Version 3.14 shipped.',
      'Great!',
      'Why?',
      '"Yes."',
      'Next',
    ]);
  });

  it('treats line breaks as boundaries', () => {
    expect(splitSentences('first line\nsecond line')).toEqual(['first line', 'second line']);
  });
});

describe('splitIntoChunks', () => {
  it('returns [] for empty or whitespace-only text', () => {
    expect(splitIntoChunks('')).toEqual([]);
    expect(splitIntoChunks('   \n ')).toEqual([]);
    expect(splitIntoChunks('🙂')).toEqual([]);
  });

  it('keeps short text as a single chunk', () => {
    expect(splitIntoChunks('你好，欢迎来到星辰科技。请先做个自我介绍吧！')).toEqual([
      '你好，欢迎来到星辰科技。请先做个自我介绍吧！',
    ]);
    expect(splitIntoChunks('Hi there. Tell me about yourself.')).toEqual(['Hi there. Tell me about yourself.']);
  });

  it('packs Chinese sentences into chunks within the weight budget', () => {
    const sentence = '这是一个用来测试分块逻辑的中文句子，长度大约二十五个字左右。';
    const text = sentence.repeat(8);
    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(textWeight(c)).toBeLessThanOrEqual(DEFAULT_CHUNK_WEIGHT);
      expect(c.endsWith('。')).toBe(true);
    }
    expect(chunks.join('')).toBe(text);
  });

  it('packs English sentences and rejoins them with spaces', () => {
    const sentence = 'This sentence is used to exercise the chunking logic in English.';
    const text = Array.from({ length: 8 }, () => sentence).join(' ');
    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(textWeight(c)).toBeLessThanOrEqual(DEFAULT_CHUNK_WEIGHT);
    expect(chunks.join(' ')).toBe(text);
  });

  it('handles mixed Chinese / English text', () => {
    const text = '我在项目里用了 React 和 TypeScript。Performance improved by 40%! 然后我们上线了。';
    const chunks = splitIntoChunks(text, 40);
    expect(chunks).toEqual(['我在项目里用了 React 和 TypeScript。', 'Performance improved by 40%!', '然后我们上线了。']);
  });

  it('breaks an over-long sentence at commas first', () => {
    const text = '第一部分内容比较长一些，第二部分内容也比较长一些，第三部分内容同样比较长一些。';
    const chunks = splitIntoChunks(text, 30);
    expect(chunks).toEqual(['第一部分内容比较长一些，', '第二部分内容也比较长一些，', '第三部分内容同样比较长一些。']);
  });

  it('hard-splits long Chinese text without any punctuation', () => {
    const text = '无标点的超长中文文本'.repeat(30); // 300 chars, weight 600
    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    for (const c of chunks) expect(textWeight(c)).toBeLessThanOrEqual(DEFAULT_CHUNK_WEIGHT);
    expect(chunks.join('')).toBe(text);
  });

  it('splits long English text without punctuation at word boundaries', () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`);
    const text = words.join(' ');
    const chunks = splitIntoChunks(text, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(60);
      expect(c).not.toMatch(/^\s|\s$/);
    }
    expect(chunks.join(' ')).toBe(text);
  });

  it('never splits a surrogate pair', () => {
    const text = '𠀀'.repeat(200);
    const chunks = splitIntoChunks(text, 50);
    expect(chunks.join('')).toBe(text);
    for (const c of chunks) expect(c).not.toMatch(/[\uD800-\uDBFF]$/);
  });
});
