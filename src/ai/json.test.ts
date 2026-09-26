import { describe, expect, it } from 'vitest';
import { extractJson } from './json';

describe('extractJson', () => {
  it('parses plain JSON objects', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('\uFEFF  {"a":"b"}  ')).toEqual({ a: 'b' });
  });

  it('finds JSON inside ```json fences and prose', () => {
    expect(extractJson('Sure! Here you go:\n```json\n{"kind":"main","n":2}\n```\nHope it helps.')).toEqual({ kind: 'main', n: 2 });
    expect(extractJson('好的，结果如下：{"score": 7, "text": "包含 } 括号 { 的字符串"} 以上。')).toEqual({ score: 7, text: '包含 } 括号 { 的字符串' });
  });

  it('skips non-JSON braces and returns the first valid object', () => {
    expect(extractJson('Use {curly} words, then {"ok": true}')).toEqual({ ok: true });
  });

  it('repairs trailing commas, comments, raw newlines and Python literals', () => {
    expect(extractJson('{"a": [1, 2,], "b": {"c": 3,},}')).toEqual({ a: [1, 2], b: { c: 3 } });
    expect(extractJson('{\n  // note\n  "a": 1, /* x */ "b": True, "c": None\n}')).toEqual({ a: 1, b: true, c: null });
    expect(extractJson('{"reaction": "line one\nline two"}')).toEqual({ reaction: 'line one\nline two' });
  });

  it('escapes stray double quotes inside strings instead of returning an inner object', () => {
    const text = '{"assessment": {"score": 7, "comment": "有数据", "affinityDelta": 3}, "kind": "main", "reaction": "你说的"灰度发布"很关键", "question": "那 "回滚" 是怎么做的？"}';
    expect(extractJson(text)).toEqual({
      assessment: { score: 7, comment: '有数据', affinityDelta: 3 },
      kind: 'main',
      reaction: '你说的"灰度发布"很关键',
      question: '那 "回滚" 是怎么做的？',
    });
    // A closing quote followed by a comment still closes the string.
    expect(extractJson('{"reaction": "好", // done\n "question": "为什么？",}')).toEqual({ reaction: '好', question: '为什么？' });
  });

  it('closes a truncated object', () => {
    expect(extractJson('{"reaction": "好的", "question": "为什么')).toEqual({ reaction: '好的', question: '为什么' });
    expect(extractJson('{"a": 1, "b": {"c": [1, 2')).toEqual({ a: 1, b: { c: [1, 2] } });
    expect(extractJson('{"a": 1, "b":')).toEqual({ a: 1 });
  });

  it('returns undefined when there is no object', () => {
    expect(extractJson('')).toBeUndefined();
    expect(extractJson(null)).toBeUndefined();
    expect(extractJson('no json here')).toBeUndefined();
    expect(extractJson('[1, 2, 3]')).toBeUndefined();
  });
});
