import { describe, expect, it } from 'vitest';
import { cleanSpeech, contentUnits, guessLang, joinSpeech, looksLikeQuestion, padCjkLatin, splitReactionQuestion, splitSentences, truncate } from './text';

describe('text helpers', () => {
  it('splits zh and en sentences without breaking abbreviations or decimals', () => {
    expect(splitSentences('你好！我是小雪。请介绍一下自己？')).toEqual(['你好！', '我是小雪。', '请介绍一下自己？']);
    expect(splitSentences('I used Node.js, e.g. for APIs. It was 3.5x faster! Why?')).toEqual([
      'I used Node.js, e.g. for APIs.',
      'It was 3.5x faster!',
      'Why?',
    ]);
    expect(splitSentences('他说：“好的！”然后走了。')).toEqual(['他说：“好的！”', '然后走了。']);
    expect(splitSentences('   ')).toEqual([]);
  });

  it('separates the trailing question from the reaction', () => {
    expect(splitReactionQuestion('嗯，明白了。那你为什么选 Redis？', 'zh')).toEqual({ reaction: '嗯，明白了。', question: '那你为什么选 Redis？' });
    expect(splitReactionQuestion('Great. Thanks for that. Could you tell me more?', 'en')).toEqual({
      reaction: 'Great. Thanks for that.',
      question: 'Could you tell me more?',
    });
    expect(splitReactionQuestion('只有一句话', 'zh')).toEqual({ reaction: '', question: '只有一句话' });
  });

  it('recognises questions and requests without mistaking remarks for them', () => {
    for (const q of ['你为什么选 Redis？', '能具体说说吗。', '你是怎么衡量效果的呢。', '那我们先从自我介绍开始吧。', '请介绍一下你自己。', '可以聊聊这个项目。', 'Tell me about the rollout.', 'So, what happened next.', "I'd love to hear about your team.", '我们直接开始吧，先做个自我介绍。', "Start with a short introduction, and focus on what you've built.", "Let's start with who you are."])
      expect(looksLikeQuestion(q), q).toBe(true);
    for (const r of ['刚才翻你的简历，GMV 做到 120 万，挺厉害的呢。', '嗯嗯，可以理解。', '我们换个话题吧。', '谢谢你的自我介绍。', '看到你在大厂待过，想必学到了不少吧。', "That's exactly what we need.", 'What a story!', 'How cool!', 'Thanks for the introduction.', "Let's see how deep they go."])
      expect(looksLikeQuestion(r), r).toBe(false);
  });

  it('does not glue a remark onto the question when splitting', () => {
    expect(splitReactionQuestion('刚才翻你的简历，GMV 做到 120 万，挺厉害的呢。那我们先从自我介绍开始吧？', 'zh')).toEqual({
      reaction: '刚才翻你的简历，GMV 做到 120 万，挺厉害的呢。',
      question: '那我们先从自我介绍开始吧？',
    });
    expect(splitReactionQuestion('谢谢你的自我介绍。你为什么想换工作？', 'zh')).toEqual({ reaction: '谢谢你的自我介绍。', question: '你为什么想换工作？' });
  });

  it('rewrites symbols that text-to-speech reads badly', () => {
    expect(cleanSpeech('激活率 31%→44%，大概 3~5 天，~60% 的用户', 'zh')).toBe('激活率 31%到44%，大概 3到5 天，约60% 的用户');
    expect(cleanSpeech('Sign-ups went 12k → 85k in 3~4 weeks, ~60% organic.', 'en')).toBe('Sign-ups went 12k to 85k in 3 to 4 weeks, about 60% organic.');
  });

  it('drops more stage directions', () => {
    expect(cleanSpeech('*pushes up glasses* Go on.', 'en')).toBe('Go on.');
    expect(cleanSpeech('(takes a note) Interesting. *jots down* Why?', 'en')).toBe('Interesting. Why?');
    expect(cleanSpeech('（记笔记）嗯，继续说。', 'zh')).toBe('嗯，继续说。');
    expect(cleanSpeech('That *really* matters.', 'en')).toBe('That really matters.');
  });

  it('strips markdown, emoji, stage directions and brackets from speech', () => {
    expect(cleanSpeech('**好的**（微笑）😊 我们开始吧！', 'zh')).toBe('好的我们开始吧！');
    expect(cleanSpeech('*nods* Great answer! (smiles) Tell me about `Redis`.', 'en')).toBe('Great answer! Tell me about Redis.');
    expect(cleanSpeech('- first\n- second', 'en')).toBe('first second');
    expect(cleanSpeech('我们用了 RESTful（表述性状态转移）接口。', 'zh')).toBe('我们用了 RESTful，表述性状态转移，接口。');
    expect(cleanSpeech('"Quoted whole line."', 'en')).toBe('Quoted whole line.');
    expect(cleanSpeech('[pause] So, why?', 'en')).toBe('So, why?');
  });

  it('measures and guesses language', () => {
    expect(contentUnits('我用 Redis')).toBe(4);
    expect(guessLang('我在字节跳动做后端开发')).toBe('zh');
    expect(guessLang('I built the checkout flow in React')).toBe('en');
    expect(guessLang('我主要用 React 和 TypeScript 开发')).toBe('zh');
    expect(guessLang('ok')).toBeNull();
  });

  it('joins, pads and truncates', () => {
    expect(joinSpeech(['你好。', '', '请坐。'], 'zh')).toBe('你好。请坐。');
    expect(joinSpeech(['Hi.', 'Sit down.'], 'en')).toBe('Hi. Sit down.');
    expect(joinSpeech(['Hi', 'Sit down.'], 'en')).toBe('Hi. Sit down.');
    expect(joinSpeech(['你好。', 'Sit down.'], 'en')).toBe('你好。 Sit down.');
    expect(joinSpeech(['你好', '请坐。'], 'zh')).toBe('你好。请坐。');
    expect(padCjkLatin('我用Go写了3个服务')).toBe('我用 Go 写了 3 个服务');
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});
