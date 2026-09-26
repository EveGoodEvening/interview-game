/**
 * Fallback lines in the interview language, used when an AI turn has to be repaired
 * (e.g. the model returned the wrong kind or an empty question) and for synthetic
 * candidate entries. These are interview content, not UI strings, so they live here
 * rather than in i18n.
 */
import type { Lang, PlanTopic } from '../types';

export const CANNED = {
  noMoreQuestions: {
    zh: '我没有其他问题了，谢谢您。',
    en: "No more questions from me. Thank you.",
  },
  reversePrompt: {
    zh: '好，我这边的问题就到这里。关于我们公司或者这个岗位，你有什么想问我的吗？',
    en: "Alright, that's all the questions I have. Is there anything you'd like to ask me about the company or the role?",
  },
  anythingElse: {
    zh: '你还有其他想了解的吗？',
    en: 'Is there anything else you would like to know?',
  },
  closing: {
    zh: '好的，今天的面试就到这里，谢谢你抽出时间。我们会在一周内给你答复，路上注意安全。',
    en: "Okay, that brings us to the end of today's interview. Thank you for your time. We'll get back to you within a week. Take care.",
  },
  followup: {
    zh: '能再具体说说吗？比如你当时具体做了什么，结果怎么样？',
    en: 'Could you be a bit more specific? For example, what exactly did you do, and what was the result?',
  },
  selfIntro: {
    zh: '先请你简单做个自我介绍吧。',
    en: "To start, could you briefly introduce yourself?",
  },
} as const satisfies Record<string, Record<Lang, string>>;

/** Generic main question for a plan topic (used when the model's question can't be used). */
export function cannedMainQuestion(topic: PlanTopic | undefined, lang: Lang): string {
  const title = topic?.title.trim();
  if (!title) return lang === 'zh' ? '接下来想听你聊聊你最有成就感的一段经历。' : "Next, I'd like to hear about the experience you're proudest of.";
  return lang === 'zh'
    ? `接下来我们聊聊「${title}」，能结合你的具体经历说说吗？`
    : `Let's move on to ${title}. Could you walk me through a concrete experience of yours?`;
}
