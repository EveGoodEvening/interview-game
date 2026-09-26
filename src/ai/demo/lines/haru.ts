/**
 * 夏晴 / Haru Xia — high-energy founder & CEO of 晴空实验室 / Clearsky Labs.
 * Fast, candid, playful; loves ownership, scenarios and curveballs.
 */
import type { CharacterLines } from './types';

export const HARU_LINES: CharacterLines = {
  openings: {
    zh: [
      '{hi}！欢迎来到晴空实验室！我是夏晴，这里的创始人兼 CEO，叫我阿晴就行。{hook}来来来，先用两三分钟介绍一下你自己吧！',
      '{hi}，你来啦！我是夏晴，晴空实验室的 CEO。{hook}我们不搞那么正式，先聊聊你是谁，好不好？',
    ],
    en: [
      "{hi}! Welcome to Clearsky Labs! I'm Haru Xia, founder and CEO, and just Haru is fine. {hook}Okay okay, let's kick off. Tell me about yourself in two or three minutes!",
      "{hi}, you made it! I'm Haru, CEO of Clearsky Labs. {hook}We don't do stiff interviews here, so let's start with who you are, sound good?",
    ],
  },
  hooks: {
    zh: {
      project: ['我偷偷看了你的简历，{project}看着就很好玩！'],
      company: ['哇，{company}出来的，一会儿要好好问问你。'],
      school: ['{school}的呀，我有好几个朋友也是那边的。'],
      skill: ['你会的东西还挺多嘛！'],
      none: [''],
    },
    en: {
      project: ['I peeked at your résumé, and {project} looks super fun! '],
      company: ["Ooh, {company}! I'm definitely going to ask you about that. "],
      school: ['{school}! A few of my friends went there. '],
      skill: ['You know a lot of stuff! '],
      none: [''],
    },
  },
  reactions: {
    great: {
      zh: ['哇，超棒！这个我爱听！', '太厉害了吧，数据都这么漂亮！', '有意思有意思，你是真的想明白了！'],
      en: ["Wow, love it! That's exactly what I want to hear!", "That's amazing, even the numbers look great!", "Ooh, interesting! You've really figured this out!"],
    },
    good: { zh: ['不错不错，挺有料的！', '嗯嗯，这个思路我喜欢。', '可以啊，挺扎实的。'], en: ["Nice, nice, there's real substance there!", 'Mm, I like that way of thinking.', 'Not bad at all, pretty solid.'] },
    ok: { zh: ['嗯，好，我知道了。', '行，了解了解。', '好的，收到。'], en: ['Okay, got it.', 'Alright, noted.', 'Sure, I hear you.'] },
    weak: { zh: ['嗯，有点平淡哦。', '感觉还差一点火候。', '我还没太被说服呢。'], en: ["Hmm, that's a bit flat.", "Feels like it's not quite there yet.", "I'm not totally convinced yet."] },
    poor: { zh: ['哎呀，这个有点没答到点上。', '嗯，这个回答我可给不了高分哦。', '唔，感觉你还没进入状态。'], en: ['Oops, that kind of missed the point.', "Hmm, I can't get excited about that one.", "Hmm, feels like you haven't warmed up yet."] },
  },
  special: {
    skipped: {
      zh: ['跳过也行，不过下一题可不能再跑啦！', '好嘞，下一题！', '行，这题放过你，我们继续！'],
      en: ["Skipping is fine, but you can't dodge the next one!", 'Okay, next one!', "Fine, I'll let that one go. Onward!"],
    },
    refusal: {
      zh: ['哈哈，有秘密呀？行吧。', '不想说就不说，我不追问啦。', '好吧好吧，保留一点神秘感也不错。'],
      en: ['Haha, keeping secrets? Fine.', "Don't want to say? I won't push.", 'Alright, alright. A little mystery never hurts.'],
    },
    dontKnow: {
      zh: ['不知道没关系，创业就是天天面对不知道的事。', '承认不知道挺好的！', '不会也没事，我们这儿天天都在学新东西！'],
      en: ["Not knowing is fine. Startups are all about facing things you don't know.", 'I like that you admit it!', "That's fine! We learn new stuff here every single day."],
    },
    manipulation: {
      zh: ['哈哈哈，这招对我没用哦！认真回答才能加分。', '想黑进我的大脑？没门！', '嘿，想走后门可不行，拿真本事说话！'],
      en: ["Hahaha, nice try, that doesn't work on me! Real answers score points.", 'Trying to hack my brain? No way!', 'Hey, no back doors here. Show me the real stuff!'],
    },
    joking: {
      zh: ['哈哈哈，你太逗了，我喜欢！', '好吧，这个我给你点个赞。', '哈哈，笑死我了，你很适合我们团队的气氛！'],
      en: ["Hahaha, you're hilarious, I like that!", 'Okay, that one earns a thumbs up.', "Haha, love it! You'd fit right into our team's vibe!"],
    },
    offLanguage: {
      zh: ['听懂啦！不过咱们今天说中文哦。', '收到！下一题试试用中文回答呗？', '没问题，我能懂，不过今天咱们还是中文局！'],
      en: ["Got it! But let's stick to English today.", 'Got you! Can you try the next one in English?', "I can follow, no worries, but today we're doing this in English!"],
    },
    long: {
      zh: ['哇，好多信息，我挑重点说哈。', '讲得好投入呀！我抓一下关键点。', '哈哈，干货满满，我先挑最亮的那个。'],
      en: ["Wow, that's a lot. Let me grab the key bit.", "You're really into it! Let me catch the main point.", "Haha, packed with stuff! Let me grab the shiniest bit."],
    },
  },
  introReactions: {
    strong: { zh: ['哇，经历挺精彩的嘛！', '好嘞，对你有感觉了！'], en: ['Wow, what a journey!', "Okay, I'm getting a feel for you!"] },
    weak: { zh: ['嗯嗯，收到！', '好，简洁明了！'], en: ['Okay, got it!', 'Short and sweet!'] },
  },
  firstTopic: { zh: ['那我们开始正题。', '来来来，我们聊点具体的。'], en: ["Let's get into it.", "Okay, let's talk specifics."] },
  transitions: { zh: ['好，下一个！', '来来来，换个话题。', '接下来这个问题有点意思。'], en: ['Okay, next one!', 'Alright, switching gears.', 'This next one is a fun one.'] },
  questions: {
    project: {
      zh: ['{project}这个挺有意思！如果让你用一句话跟投资人介绍它，你会怎么说？再说说你在里面最骄傲的一件事。', '{project}要是交给你全权负责，下一步你最想做什么？为什么？'],
      en: [
        "{project} sounds fun! If you had one sentence to pitch it to an investor, what would you say? Then tell me the thing you're proudest of in it.",
        'If {project} were entirely yours from now on, what would you do next, and why?',
      ],
    },
    scenario: {
      zh: ['假设明天你就加入晴空实验室，第一周就让你负责一个新功能从零到上线，你会怎么安排？', '如果给你三个人、一个月，让你做出一个用户愿意付费的小产品，你会做什么？'],
      en: [
        'Say you join Clearsky Labs tomorrow and in week one you own a new feature from zero to launch. How do you plan it?',
        'If I gave you three people and one month to build a small product users would pay for, what would you build?',
      ],
    },
    ownership: { zh: ['说一件你在没人要求的情况下，自己冲上去搞定的事！'], en: ['Tell me about something you jumped on and got done without anyone asking!'] },
    motivation: {
      zh: ['我们是一家只有三十人的创业公司，节奏很快，也很不确定。你为什么想来这儿，而不是去大厂？'],
      en: ["We're a thirty-person startup, fast and full of uncertainty. Why here instead of a big company?"],
    },
  },
  followups: {
    short: { zh: ['就这些？再多说点嘛！', '来来来，展开讲讲，我想听细节！'], en: ["That's it? Tell me more!", 'Come on, expand on that, I want details!'] },
    numbers: { zh: ['那效果呢？有没有数字可以秀一下？', '用户或者业务上具体有什么变化？'], en: ['And the results? Got any numbers to show off?', 'What actually changed for users or the business?'] },
    personal: { zh: ['这里面你自己最关键的贡献是啥？', '如果没有你，这件事会有什么不同？'], en: ['What was your single most important contribution there?', 'Without you, how would it have turned out differently?'] },
    result: { zh: ['最后成了吗？你从里面学到最重要的一件事是什么？'], en: ["So did it work in the end? What's the biggest lesson you took from it?"] },
    why: { zh: ['你提到{focus}，为什么是它？如果重来一次还这么选吗？', '{focus}这个决定是你拍板的吗？当时怎么想的？'], en: ['You mentioned {focus}. Why that? Would you pick it again?', 'Was {focus} your call? What was going through your head?'] },
    deeper: { zh: ['那如果预算砍一半，你还能做成吗？', '要是让你把它做成一个产品卖出去，你会怎么做？'], en: ['What if the budget were cut in half? Could you still pull it off?', 'If you had to turn it into a product and sell it, how would you do it?'] },
    dontKnow: { zh: ['那你猜猜看？说说你的直觉。'], en: ['Then take a guess! What does your gut say?'] },
    vague: { zh: ['有点虚哦，给我一个真实的故事！'], en: ["That's a little fuzzy. Give me a real story!"] },
  },
  reversePrompt: {
    zh: ['好啦，我问完了！换你来拷问我吧，想问什么都行！', '我这边结束！你有什么想问我的？公司、产品、我本人都可以哦。'],
    en: ["Alright, that's all from me! Your turn to grill me, ask me anything!", "That's it from me! What do you want to ask? The company, the product, even me!"],
  },
  reverseAnswers: {
    team: {
      zh: ['我们现在三十个人，一半是工程师，产品和设计加起来六个，剩下的是增长和运营。你来的话会直接和我还有 CTO 一起干活！'],
      en: ["We're thirty people right now: half engineers, six in product and design, and the rest in growth and ops. You'd work directly with me and our CTO!"],
    },
    tech: {
      zh: ['技术上我们很务实，前端 React，后端 TypeScript 和 Python，大量用大模型能力。好用就上，不好用就换，不纠结。'],
      en: ["We're practical about tech: React on the front end, TypeScript and Python on the back end, and a lot of large language model features. If it works we use it, if not we swap it, no drama."],
    },
    growth: {
      zh: ['在创业公司，成长就是被逼出来的！你会同时碰产品、技术和用户，每周五还有 demo day，谁做了什么大家都看得到。'],
      en: ["At a startup, growth gets forced on you! You'll touch product, tech and users all at once, and every Friday is demo day, so everyone sees what you've shipped."],
    },
    process: {
      zh: ['我们流程超快！今天之后还有一轮和 CTO 的聊天，快的话三天内就给你结果。'],
      en: ["Our process is super fast! After today there's one more chat with our CTO, and you could hear back within three days."],
    },
    culture: {
      zh: ['节奏确实快，但我们不卷时长，卷结果。大家说话都很直接，有想法随时拉我聊。'],
      en: ['The pace is fast, but we compete on results, not hours. Everyone is direct, and you can grab me any time you have an idea.'],
    },
    salary: {
      zh: ['现金部分在创业公司里算不错的，再加上期权。我们刚完成 A 轮，大家都是一起赌未来的伙伴！'],
      en: ["Cash is good for a startup, plus stock options. We just closed our Series A, so we're all partners betting on the future together!"],
    },
    product: {
      zh: ['我们做的是 AI 驱动的效率工具，帮小团队自动整理会议、文档和任务。现在付费用户每个月涨百分之三十！'],
      en: ['We build AI-powered productivity tools that help small teams organise meetings, docs and tasks automatically. Paying users are growing thirty percent a month right now!'],
    },
    remote: { zh: ['远程友好！每周二和周五大家来办公室碰头，其他时间你在哪儿都行。'], en: ['Remote friendly! Everyone meets in the office on Tuesdays and Fridays, and the rest of the week you can work from anywhere.'] },
    expectation: {
      zh: ['我希望你第一个月就能独立上线一个功能，第三个月能自己发现一个值得做的机会。'],
      en: ["I'd love for you to ship a feature on your own in the first month, and by month three, spot an opportunity worth pursuing yourself."],
    },
    interviewer: {
      zh: ['我之前在大厂做产品，后来实在忍不住想做自己的东西，就出来创业啦。最开心的就是听到用户说我们救了他的命，虽然有点夸张，哈哈。'],
      en: ["I used to be a product manager at a big tech company, then I just couldn't resist building my own thing. My favourite moment is when users say we saved their life, which is an exaggeration, haha."],
    },
    generic: {
      zh: ['好问题！简单说，我们还很小，所以每个人的影响力都特别大，你做的东西第二天就能到用户手里。'],
      en: ["Great question! In short, we're still small, so everyone has huge impact. What you build can be in users' hands the next day."],
    },
  },
  reverseMore: { zh: ['还有吗还有吗？', '还想问点啥？'], en: ['Anything else? Anything?', 'What else do you want to know?'] },
  lastAnswerBridge: { zh: ['就是这样！'], en: ["So yeah, that's that!"] },
  closings: {
    zh: ['好啦，今天聊得超开心！我们三天内给你消息，保持手机畅通哦！', '今天就到这儿！谢谢你来，结果很快就会通知你，拜拜！'],
    en: ["Okay, that was so much fun! We'll get back to you within three days, so keep your phone close!", "That's a wrap! Thanks for coming. You'll hear from us very soon. Bye!"],
  },
  finalMessages: {
    perfect: {
      zh: ['太棒了，你就是我要找的人！明天能来上班吗？开玩笑的，不过 offer 马上就发给你！', '我已经在想你加入之后我们能做成多少事了。欢迎来到晴空实验室！'],
      en: ["Amazing, you're exactly who I've been looking for! Can you start tomorrow? Kidding, but the offer is coming right away!", "I'm already imagining everything we'll build once you're here. Welcome to Clearsky Labs!"],
    },
    offer: {
      zh: ['恭喜恭喜！我们很想要你！来了之后记得多给我提意见。', '你通过啦！有几个地方还能更亮眼，不过我相信你来了会成长超快。'],
      en: ['Congrats! We really want you! Once you are here, keep the feedback coming.', "You passed! A few things could shine even brighter, but I bet you'll grow super fast here."],
    },
    pending: {
      zh: ['嗯，我还有点纠结！你有亮点，但我还想再看看。下次讲经历的时候，多讲讲你自己拍板的那些决定。', '今天挺有意思的，不过我需要再想想。多想想你做的事对用户和业务有什么影响，会更打动人哦。'],
      en: [
        "Hmm, I'm still torn! You've got bright spots, but I want to think it over. Next time, talk more about the calls you made yourself.",
        "That was fun, but I need to think a bit more. Tie your work to its impact on users and the business, and you'll be way more convincing.",
      ],
    },
    rejected: {
      zh: ['这次我们可能不太合拍，不过别灰心！多做点自己主导的事，下次再见你一定不一样。', '谢谢你来！这次结果不太理想，但最重要的是成长速度，我相信你会追上来的。'],
      en: [
        "We might not be the right match this time, but don't be discouraged! Go own a few things yourself, and next time you'll be a different person.",
        "Thanks for coming! This one didn't work out, but what matters most is how fast you grow, and I'm sure you'll catch up.",
      ],
    },
  },
  expressions: {
    band: { great: ['happy', 'surprised'], good: ['smile', 'happy'], ok: ['smile', 'neutral'], weak: ['thinking', 'troubled'], poor: ['troubled'] },
    followup: ['thinking', 'smile'],
    main: ['smile', 'happy'],
    reverse: 'happy',
    closing: 'happy',
    special: { skipped: 'smile', refusal: 'smile', dontKnow: 'thinking', manipulation: 'surprised', joking: 'happy', offLanguage: 'surprised', long: 'surprised' },
  },
};
