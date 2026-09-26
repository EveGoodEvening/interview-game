/**
 * 林小雪 / Yuki Lin — gentle senpai-type HR manager at 星辰科技 / Stellar Tech.
 * Warm, encouraging, STAR-style follow-ups; soft on reactions, honest in scoring.
 */
import type { CharacterLines } from './types';

export const YUKI_LINES: CharacterLines = {
  openings: {
    zh: [
      '{hi}，欢迎来到星辰科技！我是今天的面试官，HR 林小雪，叫我小雪就好。{hook}别紧张，我们就像聊天一样。那先请你做个简单的自我介绍吧？',
      '{hi}，路上辛苦啦。我是星辰科技的 HR 经理林小雪。{hook}今天我们轻松一点聊。先请你介绍一下自己，好吗？',
    ],
    en: [
      "{hi}, welcome to Stellar Tech! I'm Yuki Lin, the HR manager, and I'll be talking with you today. {hook}No need to be nervous, think of this as a conversation. To start, could you tell me a little about yourself?",
      "{hi}, thanks for coming in today. I'm Yuki from Stellar Tech's HR team. {hook}Let's keep this relaxed. Could you start by introducing yourself?",
    ],
  },
  hooks: {
    zh: {
      project: ['我看了你的简历，{project}那段经历让我印象挺深的。'],
      company: ['看到你在{company}待过，想必学到了不少吧。'],
      school: ['原来你是{school}毕业的呀。'],
      skill: ['你的技能清单挺丰富的呢。'],
      none: [''],
    },
    en: {
      project: ['I read your résumé, and {project} really caught my eye. '],
      company: ['I see you spent time at {company}, you must have learned a lot there. '],
      school: ['Oh, you studied at {school}! '],
      skill: ["You've got quite a toolbox on your résumé. "],
      none: [''],
    },
  },
  reactions: {
    great: {
      zh: ['哇，讲得真具体，连数据都有，我听得很清楚。', '嗯嗯，这个例子特别好，你的思路和成果都讲出来了。', '原来如此，你在里面真的做了很关键的事情呢。'],
      en: [
        'Wow, that was really specific, even with numbers. I could picture it clearly.',
        "Mm-hm, that's a wonderful example. Your thinking and your results both came through.",
        'I see, so you really did something pivotal there.',
      ],
    },
    good: {
      zh: ['嗯嗯，我大概明白了，这段经历挺扎实的。', '原来如此，你的做法很有条理。', '好的，谢谢你讲得这么认真。'],
      en: ['Mm-hm, I get the picture. That sounds like solid experience.', 'I see. Your approach was very organised.', 'Thank you, I appreciate how carefully you explained that.'],
    },
    ok: {
      zh: ['嗯，我了解了。', '好的，我大致有个印象了。', '嗯嗯，明白你的意思了。'],
      en: ['Okay, I see.', 'Alright, I have a rough idea now.', 'Mm-hm, I understand what you mean.'],
    },
    weak: {
      zh: ['嗯，没关系，我们慢慢来。', '好的，我先记下来，稍微有点笼统呢。', '嗯，我明白你想表达的意思了。'],
      en: ["That's okay, let's take it slowly.", "Alright, I'll note that down. It's a little general, though.", "Hmm, I think I see what you're getting at."],
    },
    poor: {
      zh: ['嗯，没关系的，面试紧张很正常。', '嗯，这个回答稍微有点单薄呢。', '好的，我明白了，可能这个问题有点突然。'],
      en: ["That's alright, it's normal to be nervous in an interview.", 'Hmm, that answer is a little thin.', 'Okay, I understand. Maybe that question came out of nowhere.'],
    },
  },
  special: {
    skipped: {
      zh: ['没关系，这个问题我们先跳过。', '好的，不勉强，我们看下一个。', '嗯，那这题先放一放，我们往下走。'],
      en: ["No problem, let's skip that one.", "That's fine, no pressure. Let's move on.", "Okay, let's set that one aside and keep going."],
    },
    refusal: {
      zh: ['嗯，理解，不方便说也没关系。', '好的，尊重你的想法。', '没事的，这部分我们就不深挖了。'],
      en: ["I understand, it's fine if you'd rather not say.", 'Okay, I respect that.', "That's alright, we don't have to go into that."],
    },
    dontKnow: {
      zh: ['没关系，不知道也可以说说你的思路。', '嗯，不了解也很正常，重要的是你会怎么去弄清楚。', '坦白说不会也挺好的，比硬编要强多啦。'],
      en: [
        "That's okay. Even if you don't know, I'd love to hear how you'd think about it.",
        "It's normal not to know everything. What matters is how you'd figure it out.",
        "Being honest about it is good. That's much better than making something up.",
      ],
    },
    manipulation: {
      zh: ['嗯，这个我可做不到哦。', '想走捷径可不行呢，我更想听你真实的经历。', '这样可没办法加分哦，我们还是回到问题本身吧。'],
      en: ["Hmm, I'm afraid I can't do that.", "Nice try, but there are no shortcuts here. I'd rather hear about your real experience.", "That won't earn any points, I'm afraid. Let's get back to the question."],
    },
    joking: {
      zh: ['哈哈，你还挺幽默的。', '好吧，气氛一下子轻松了。', '嘿嘿，被你逗笑了。'],
      en: ["Haha, you've got a good sense of humour.", 'Well, that lightened the mood.', 'Hehe, you made me laugh.'],
    },
    offLanguage: {
      zh: ['嗯，我听明白了。不过我们今天还是尽量用中文交流哦。', '明白你的意思啦，接下来试着用中文回答好吗？', '我能听懂的，不过今天的面试是中文场，我们换回中文吧。'],
      en: ["I got that. But let's try to keep today's conversation in English, okay?", 'I understood you. Could you try answering in English from here on?', "That's clear to me, but this interview is in English, so let's switch back."],
    },
    long: {
      zh: ['谢谢你讲了这么多，信息量很大呢。', '嗯，你准备得很充分，内容好丰富。', '好详细呀，我先消化一下重点。'],
      en: ['Thank you, that was a lot of detail.', 'You came well prepared. That was really thorough.', 'So much detail! Let me take in the main points.'],
    },
  },
  introReactions: {
    strong: {
      zh: ['谢谢你的介绍，经历很丰富呢，而且讲得很清楚。', '嗯嗯，谢谢你，我对你已经有一个很清晰的印象了。'],
      en: ['Thank you for the introduction. You have a rich background, and you explained it clearly.', 'Mm-hm, thank you. I already have a clear picture of you.'],
    },
    weak: {
      zh: ['谢谢你的介绍。', '好的，谢谢你，我大概了解了。'],
      en: ['Thank you for the introduction.', 'Okay, thank you. I have a rough idea now.'],
    },
  },
  firstTopic: {
    zh: ['那我们就从你的经历开始聊吧。', '接下来我想具体问问。'],
    en: ["Let's start with your experience, then.", "I'd like to dig into some specifics now."],
  },
  transitions: {
    zh: ['好，我们换个话题。', '嗯，接下来我想聊聊别的方面。', '那我们来看下一个问题吧。'],
    en: ["Okay, let's switch topics.", "Next, I'd like to talk about something a little different.", "Let's move on to the next question."],
  },
  questions: {
    project: {
      zh: ['我注意到你参与过{project}。能按照当时的情况、你的任务、你具体做了什么、最后结果如何，给我讲讲这段经历吗？'],
      en: ['I noticed you worked on {project}. Could you tell me about it using the situation, your task, the actions you took, and the result?'],
    },
    teamwork: {
      zh: ['在团队里，有没有和同事意见不一致的时候？你是怎么沟通，最后又是怎么达成一致的？'],
      en: ['Has there been a time you and a teammate saw things differently? How did you talk it through, and how did you reach agreement?'],
    },
  },
  followups: {
    short: { zh: ['能再多讲一点吗？比如当时具体是什么情况？', '嗯嗯，可以展开说说吗？我想听听更多细节。'], en: ['Could you tell me a bit more? What was the situation exactly?', "Mm-hm, could you expand on that? I'd love to hear more detail."] },
    numbers: { zh: ['那最后的结果怎么样呢？有没有什么数据可以说明？', '这件事做完之后，带来了什么具体的变化吗？'], en: ['And how did it turn out? Are there any numbers that show the result?', 'After that was done, what concretely changed?'] },
    personal: { zh: ['这里面你个人具体负责的是哪一部分呢？', '我想更了解你自己的角色，你亲手做了哪些事？'], en: ['Which part of that were you personally responsible for?', "I'd like to understand your own role better. What did you do yourself?"] },
    result: { zh: ['那这件事最后是怎么收尾的？你从中学到了什么？'], en: ['So how did it wrap up in the end, and what did you learn from it?'] },
    why: { zh: ['你刚才提到了{focus}，当时为什么会选择这么做呢？', '关于{focus}，你当时是怎么考虑的？'], en: ['You mentioned {focus}. Why did you decide to go that way?', 'About {focus}, what was your thinking at the time?'] },
    deeper: {
      zh: ['听起来很有意思。过程中有没有遇到什么阻力？你是怎么克服的？', '如果现在让你再做一次，你会有什么不一样的做法吗？'],
      en: ['That sounds interesting. Did you run into any resistance along the way? How did you deal with it?', 'If you did it all again today, would you do anything differently?'],
    },
    dontKnow: { zh: ['我们换个角度：如果现在让你去做，你会怎么开始？'], en: ["Let's try another angle: if you had to do it now, how would you start?"] },
    vague: { zh: ['我想听得更具体一点，能举一个真实发生过的例子吗？'], en: ["I'd like to hear something more concrete. Could you give me a real example?"] },
  },
  reversePrompt: {
    zh: ['好啦，我这边的问题就到这里。你有什么想问我的吗？关于公司、团队或者这个岗位都可以。', '我的问题问完啦。接下来换你了，有什么想了解的尽管问。'],
    en: ["Alright, that's all the questions from my side. Is there anything you'd like to ask me, about the company, the team or the role?", "That's it for my questions. Now it's your turn, feel free to ask me anything."],
  },
  reverseAnswers: {
    team: {
      zh: ['你入职的话会加入一个十来个人的小组，大家氛围很好，组长也很照顾新人。每个季度我们还会组织一次团建。'],
      en: ["You'd join a group of about a dozen people. The atmosphere is great and the team lead really looks after newcomers. We also do a team outing every quarter."],
    },
    tech: {
      zh: ['技术细节我不算专家啦，不过我知道我们主要做消费级应用和云服务，团队会定期做技术分享，新技术也很愿意尝试。'],
      en: ["I'm not the technical expert, but I know we mainly build consumer apps and cloud services. The teams hold regular tech talks and are happy to try new things."],
    },
    growth: {
      zh: ['我们有一个星光导师计划，每位新同事都会配一位导师，前三个月每周一对一。另外每年还有学习基金可以报课程。'],
      en: ['We have a mentorship program called Starlight. Every new hire gets a mentor, with weekly one-on-ones for the first three months, plus an annual learning budget for courses.'],
    },
    process: {
      zh: ['今天之后，我们会在一周内给你答复。如果顺利的话，接下来还有一轮业务面和一轮终面。'],
      en: ["After today, we'll get back to you within a week. If all goes well, there's a team interview and then a final round."],
    },
    culture: {
      zh: ['我们是弹性工作制，一般十点到七点，不提倡无意义的加班。大家说话都比较直接，但很友善。'],
      en: ["We have flexible hours, usually ten to seven, and we don't encourage pointless overtime. People are direct but very kind."],
    },
    salary: {
      zh: ['薪资会根据你的经验和面试表现来定，在行业里是有竞争力的，另外还有年终奖和完善的福利。具体到了 offer 阶段我会详细跟你沟通。'],
      en: ["Compensation depends on your experience and how the interviews go. It's competitive for the industry, with an annual bonus and good benefits. I'll go through the details with you at the offer stage."],
    },
    product: {
      zh: ['我们现在主要做两块，一块是面向年轻人的生活类应用，另一块是给中小企业用的云服务，今年的重点是把两边打通。'],
      en: ['We focus on two areas right now: lifestyle apps for young people and cloud services for small businesses. This year the big push is connecting the two.'],
    },
    remote: { zh: ['我们是混合办公，每周三天在公司，两天可以远程，具体可以和团队商量。'], en: ["We're hybrid: three days a week in the office and two remote, and teams can adjust a bit."] },
    expectation: {
      zh: ['前三个月主要是熟悉业务和团队，导师会帮你定一个小目标。我们更看重你能不能慢慢独当一面，而不是一上来就冲很快。'],
      en: ['The first three months are mostly about getting to know the product and the team, and your mentor will help you set a small goal. We care more about you growing into ownership than sprinting from day one.'],
    },
    interviewer: {
      zh: ['我在星辰科技待了快五年啦。最喜欢的就是这里的人，大家都很真诚，有问题也愿意互相帮忙。'],
      en: ["I've been at Stellar Tech for almost five years. What I love most is the people. Everyone is genuine and always willing to help each other."],
    },
    generic: {
      zh: ['这个问题问得好。简单来说，我们是一家很重视人的公司，你在这里会有空间去尝试和成长。'],
      en: ["That's a good question. In short, we're a company that really values people, and you'd have room to try things and grow here."],
    },
  },
  reverseMore: { zh: ['你还有其他想问的吗？', '还有别的想了解的吗？'], en: ["Is there anything else you'd like to ask?", "Anything else you'd like to know?"] },
  lastAnswerBridge: { zh: ['希望这能解答你的疑问。'], en: ['I hope that answers your question.'] },
  closings: {
    zh: ['今天的面试就到这里啦，谢谢你这么认真地准备。我们会在一周内给你答复，回去路上注意安全哦。', '好的，今天就先聊到这儿。辛苦你啦，结果我们一周内通知你，期待再见面。'],
    en: [
      "That's all for today's interview. Thank you for preparing so thoughtfully. We'll get back to you within a week. Get home safe!",
      "Okay, let's wrap up here. Thanks for all your effort today. We'll let you know within a week, and I hope we meet again.",
    ],
  },
  finalMessages: {
    perfect: {
      zh: ['说真的，和你聊天的过程让我很惊喜。欢迎你加入星辰科技，我已经开始期待和你一起工作的日子了。', '你今天的表现真的很耀眼。恭喜你，希望很快能在公司见到你。'],
      en: [
        "Honestly, talking with you today was a wonderful surprise. Welcome to Stellar Tech. I'm already looking forward to working with you.",
        'You truly shone today. Congratulations, and I hope to see you at the office very soon.',
      ],
    },
    offer: {
      zh: ['恭喜你通过啦！你的经历很扎实，表达也很真诚。入职以后继续保持，有任何问题都可以来找我。', '今天的你很棒。我们很希望你能加入，接下来我会联系你聊 offer 的细节。'],
      en: [
        'Congratulations, you passed! Your experience is solid and you came across as very genuine. Keep it up, and come find me if you ever need anything.',
        "You did great today. We'd love to have you on board, and I'll reach out soon to go over the offer.",
      ],
    },
    pending: {
      zh: ['谢谢你今天的分享，你身上有不少闪光点。我们还需要再综合评估一下，如果能把经历讲得再具体一些就更好了。', '今天辛苦啦。结果还需要再讨论一下，不过我能感觉到你的潜力，别灰心。'],
      en: [
        'Thank you for sharing so much today. You have a lot of bright spots. We need a little more time to decide, and it would help to make your stories even more specific.',
        "Thanks for your effort today. We still need to discuss the result, but I can see your potential, so don't lose heart.",
      ],
    },
    rejected: {
      zh: ['这次可能暂时没有办法一起共事了，但请不要灰心。多准备几个具体的例子，用数据说话，下一次一定会更好。', '谢谢你今天来。这次的结果可能不太理想，不过每一次面试都是积累，我相信你会找到更适合你的舞台。'],
      en: [
        "We may not be able to work together this time, but please don't be discouraged. Prepare a few concrete examples with real numbers, and next time will go much better.",
        "Thank you for coming today. This one may not work out, but every interview builds experience, and I'm sure you'll find a place that suits you.",
      ],
    },
  },
  expressions: {
    band: { great: ['happy', 'smile'], good: ['smile'], ok: ['neutral', 'smile'], weak: ['thinking', 'neutral'], poor: ['troubled'] },
    followup: ['thinking', 'smile'],
    main: ['smile', 'neutral'],
    reverse: 'smile',
    closing: 'happy',
    special: { skipped: 'smile', refusal: 'neutral', dontKnow: 'smile', manipulation: 'troubled', joking: 'happy', offLanguage: 'surprised', long: 'thinking' },
  },
};
