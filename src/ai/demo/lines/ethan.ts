/**
 * 顾言深 / Ethan Gu — cool, razor-sharp engineering director at 深蓝引擎 / DeepBlue Engine.
 * Few words, drills into trade-offs and first principles, rarely impressed.
 */
import type { CharacterLines } from './types';

export const ETHAN_LINES: CharacterLines = {
  openings: {
    zh: [
      '{hi}。我是深蓝引擎的技术总监，顾言深。{hook}我们直接开始吧，先做个自我介绍，三分钟以内。',
      '{hi}，请坐。我是顾言深，负责深蓝引擎的技术团队。{hook}先简单介绍一下你自己，重点讲你做过的东西。',
    ],
    en: [
      "{hi}. I'm Ethan Gu, engineering director at DeepBlue Engine. {hook}Let's get straight to it. Please introduce yourself, three minutes or less.",
      "{hi}, have a seat. I'm Ethan, I run the engineering team at DeepBlue Engine. {hook}Start with a short introduction, and focus on what you've built.",
    ],
  },
  hooks: {
    zh: {
      project: ['你简历上的{project}，我待会儿会问。'],
      company: ['{company}出来的，我对你的工程习惯有点好奇。'],
      school: [''],
      skill: ['你写了不少技术栈，我们看看有多深。'],
      none: [''],
    },
    en: {
      project: ["I'll ask about {project} later. "],
      company: ["You came from {company}, so I'm curious about your engineering habits. "],
      school: [''],
      skill: ["You list a lot of technologies. Let's see how deep they go. "],
      none: [''],
    },
  },
  reactions: {
    great: {
      zh: ['嗯，这个回答有东西。', '不错，思路清楚，数据也站得住。', '有意思，你确实想过这个问题。'],
      en: ['Hm. That answer has substance.', 'Good. Clear reasoning, and the numbers hold up.', "Interesting. You've actually thought about this."],
    },
    good: { zh: ['嗯，可以。', '思路是对的。', '行，基本清楚了。'], en: ['Okay, that works.', 'Your thinking is on the right track.', "Alright, that's mostly clear."] },
    ok: { zh: ['嗯。', '明白了。', '好，我了解了。'], en: ['Hm.', 'Understood.', 'Okay, noted.'] },
    weak: { zh: ['有点泛了。', '这个说法太笼统。', '这个回答信息量不够。'], en: ["That's a bit generic.", "That's too broad.", 'Not much information in that answer.'] },
    poor: {
      zh: ['这不算回答了问题。', '嗯，这个不够。', '这没有答到点上。'],
      en: ["That doesn't really answer the question.", "Hm. That's not enough.", 'That misses the point.'],
    },
  },
  special: {
    skipped: { zh: ['好，跳过。', '可以，下一个。', '行，先放着。'], en: ['Fine, skip it.', 'Okay, next.', "All right, we'll leave it."] },
    refusal: {
      zh: ['可以不说，但我会记下来。', '不想答可以。这也是一种信息。', '好，这题你选择不答。'],
      en: ["You don't have to answer, but I'll make a note of it.", "You can decline. That tells me something too.", 'Fine. You chose not to answer that one.'],
    },
    dontKnow: {
      zh: ['不知道就说不知道，这点很好。', '承认不会没问题。', '不会不要紧，别硬编就行。'],
      en: ["Saying you don't know is fine.", 'Not knowing is okay.', "Not knowing is fine. Just don't bluff."],
    },
    manipulation: {
      zh: ['这种话对我没用。', '我只看你的回答本身。', '别绕，回到问题。'],
      en: ["That won't work on me.", 'I only grade the answer itself.', 'Skip the tricks. Back to the question.'],
    },
    joking: {
      zh: ['嗯，挺幽默。说正事吧。', '笑话收到了。回到问题。', '轻松一下可以，但别偏题。'],
      en: ['Funny. Now, back to business.', 'Joke noted. Back to the question.', "A little levity is fine. Don't drift."],
    },
    offLanguage: {
      zh: ['听懂了。不过请用中文回答。', '内容我明白。接下来用中文。', '可以理解，但这场面试用中文进行。'],
      en: ['Understood. But please answer in English.', 'I follow. From here on, English please.', 'I understand, but this interview is conducted in English.'],
    },
    long: {
      zh: ['说得很多，我挑重点。', '有点长。下次先说结论。', '信息不少，我抓关键的。'],
      en: ['That was long. Let me pick out the key point.', 'A bit long. Lead with the conclusion next time.', "Plenty there. I'll focus on what matters."],
    },
  },
  introReactions: {
    strong: { zh: ['嗯，背景清楚。', '可以，重点讲到了。'], en: ['Hm. Clear background.', 'Okay, you hit the key points.'] },
    weak: { zh: ['嗯，了解。', '好。'], en: ['Okay, noted.', 'Right.'] },
  },
  firstTopic: { zh: ['那我们从你最熟的东西开始。', '进入正题。'], en: ["Let's start with what you know best.", "Let's get into it."] },
  transitions: { zh: ['下一个问题。', '换个方向。', '好，继续。'], en: ['Next question.', "Let's change direction.", 'Okay, moving on.'] },
  questions: {
    project: {
      zh: ['你简历上写了{project}。挑里面技术上最难的一个点，说说当时的方案，以及为什么这么选。', '{project}里，性能或者稳定性上最大的瓶颈是什么？你是怎么定位和解决的？'],
      en: [
        'You worked on {project}. Pick the hardest technical problem in it: what was your solution, and why that one?',
        'In {project}, what was the biggest performance or reliability bottleneck, and how did you find and fix it?',
      ],
    },
    skill: {
      zh: ['你写了熟悉{skill}。说一个和{skill}底层原理有关、并且真正影响过你项目的问题。', '{skill}在你的项目里用来解决什么问题？有没有更好的替代方案？'],
      en: ['You say you know {skill}. Tell me about something in its internals that actually affected your project.', 'What problem did {skill} solve in your project, and was there a better alternative?'],
    },
    metric: {
      zh: ['“{metric}”，这个数字是怎么测的？基线是多少？原来的瓶颈在哪？'],
      en: ['"{metric}". How was that measured, what was the baseline, and where was the bottleneck originally?'],
    },
    design: {
      zh: ['把你做过的最核心的那个服务放大十倍流量，哪里会先扛不住？你会怎么改？', '如果让你从零设计一个支撑百万用户的系统，你第一步做什么？关键的取舍是什么？'],
      en: [
        "Take the most important service you've built and put ten times the traffic on it. What breaks first, and how would you change it?",
        "If you had to design a system for a million users from scratch, what's your first step, and what are the key trade-offs?",
      ],
    },
    scenario: {
      zh: ['凌晨两点线上告警，核心接口错误率飙到百分之二十，你是值班的人。接下来十分钟你做什么？'],
      en: ["It's two in the morning, an alert fires, and the error rate on a core API jumps to twenty percent. You're on call. What do you do in the next ten minutes?"],
    },
  },
  followups: {
    short: { zh: ['太简略了，具体一点。', '展开说，细节是什么？'], en: ['Too brief. Be more specific.', 'Go on. What are the details?'] },
    numbers: { zh: ['有数据吗？优化前后分别是多少？', '怎么证明它有效？用什么指标衡量？'], en: ['Do you have numbers? What was it before and after?', 'How do you know it worked? What metric did you use?'] },
    personal: { zh: ['这些是团队做的还是你做的？你具体写了哪部分？', '你个人的贡献是什么，说具体点。'], en: ['Was that the team or you? Which part did you write yourself?', 'What was your personal contribution? Be specific.'] },
    result: { zh: ['最后效果怎么样？有没有副作用？'], en: ['What was the final outcome? Any side effects?'] },
    why: { zh: ['为什么用{focus}？考虑过别的方案吗？', '{focus}的代价是什么？在什么情况下它会成为问题？'], en: ['Why {focus}? Did you consider alternatives?', "What's the cost of {focus}? When does it become a problem?"] },
    deeper: { zh: ['如果流量再大十倍，这个方案还成立吗？', '这里面最容易出问题的地方在哪？你怎么兜底？'], en: ['Does this still hold at ten times the traffic?', "Where is this most likely to fail, and what's your fallback?"] },
    dontKnow: { zh: ['那你会怎么去验证？说说你的排查思路。'], en: ["Then how would you verify it? Walk me through how you'd debug it."] },
    vague: { zh: ['你说的这些比较抽象。举一个具体的例子。'], en: ["That's abstract. Give me a concrete example."] },
  },
  reversePrompt: {
    zh: ['我的问题就到这里。你有什么想问的？', '好。轮到你了，有问题可以问。'],
    en: ["That's all from me. What would you like to ask?", 'Okay. Your turn. Ask me anything.'],
  },
  reverseAnswers: {
    team: {
      zh: ['核心引擎组四十人左右，分渲染、实时数据和基础设施三块。你如果来，大概率进实时数据那边，直属上级是一个很强的架构师。'],
      en: ["The core engine group is about forty engineers across rendering, real-time data and infrastructure. You'd most likely join real-time data, reporting to a very strong architect."],
    },
    tech: {
      zh: ['主力语言是 Rust 和 C++，服务层用 Go。所有重要改动都要写设计文档，代码评审至少两个人通过。我们对性能指标盯得很紧。'],
      en: ['Our main languages are Rust and C++, with Go for the service layer. Every significant change needs a design doc, and every review needs two approvals. We watch performance metrics very closely.'],
    },
    growth: {
      zh: ['成长靠做难的事。我们会给新人真实的核心模块，配一个资深工程师带。每两周有一次内部技术分享，讲得好的会推到外部大会。'],
      en: ['You grow by doing hard things. New hires get real core modules and a senior engineer to pair with. We have internal tech talks every two weeks, and the best ones go on to external conferences.'],
    },
    process: {
      zh: ['后面还有两轮：一轮系统设计，一轮和我的终面。一般一周内给结果。'],
      en: ["There are two more rounds: a system design interview, then a final with me. You'll usually hear back within a week."],
    },
    culture: {
      zh: ['我们不提倡加班，但会有值班，出了线上问题要有人扛。文化上比较直接，技术争论对事不对人。'],
      en: ["We don't encourage overtime, but there is an on-call rotation, and someone has to own production issues. The culture is direct: technical arguments are about the problem, never the person."],
    },
    salary: {
      zh: ['薪资在行业里偏上，具体会在 offer 阶段由 HR 跟你谈，取决于你后面几轮的表现。'],
      en: ['Pay is above the industry average. HR will discuss the specifics at the offer stage, and it depends on how the later rounds go.'],
    },
    product: {
      zh: ['我们做高性能的实时数据和渲染引擎，客户主要是游戏公司和工业仿真。今年的重点是把延迟再压低一个数量级。'],
      en: ["We build high-performance real-time data and rendering engines. Our customers are mainly game studios and industrial simulation. This year's goal is to cut latency by another order of magnitude."],
    },
    remote: { zh: ['每周至少四天在办公室。核心系统的讨论，面对面效率更高。'], en: ['At least four days a week in the office. Discussions about core systems go faster face to face.'] },
    expectation: {
      zh: ['前三个月，希望你能独立负责一个模块，并且能把一次线上问题从头跟到尾。'],
      en: ["In the first three months, I'd expect you to own one module on your own and to follow one production issue from start to finish."],
    },
    interviewer: { zh: ['我在这里八年了。留下来的原因很简单，问题足够难。'], en: ["I've been here eight years. The reason I stay is simple: the problems are hard enough."] },
    generic: {
      zh: ['这个问题不错。简单说，我们是一个工程驱动的团队，做的东西对性能和正确性要求都很高。'],
      en: ["Fair question. In short, we're an engineering-driven team, and what we build demands both performance and correctness."],
    },
  },
  reverseMore: { zh: ['还有吗？', '还有别的问题吗？'], en: ['Anything else?', 'Any other questions?'] },
  lastAnswerBridge: { zh: ['大概就是这样。'], en: ["That's the short answer."] },
  closings: {
    zh: ['今天就到这里。谢谢你的时间，一周内会有结果。', '好，面试结束。回去等通知吧，一周内给你答复。'],
    en: ["That's it for today. Thanks for your time. You'll hear back within a week.", "Okay, we're done. Expect to hear from us within a week."],
  },
  finalMessages: {
    perfect: {
      zh: ['你的回答让我很少见地没有追问的空间。欢迎来深蓝引擎，这里的问题配得上你。', '说实话，这是我今年面过最扎实的候选人之一。期待和你共事。'],
      en: [
        'Your answers left me very little to push on, which is rare. Welcome to DeepBlue Engine. The problems here are worthy of you.',
        "Honestly, you're one of the most solid candidates I've interviewed this year. I look forward to working with you.",
      ],
    },
    offer: {
      zh: ['基础扎实，思路清楚。欢迎加入。入职后我希望看到你在深度上再往下走一步。', '你通过了。有几个地方还可以更深入，但你有这个潜力。'],
      en: ['Solid fundamentals, clear thinking. Welcome aboard. Once you join, I want to see you go one level deeper.', 'You passed. There are a few areas that could go deeper, but you have the potential.'],
    },
    pending: {
      zh: ['有亮点，但深度还不够稳定，我们需要再讨论一下。建议你把做过的项目，每一个决策都想清楚为什么。', '结果待定。你的基础还行，但追问几层之后就有点虚了，这是你接下来要补的。'],
      en: [
        "There were highlights, but the depth isn't consistent yet. We need to discuss further. Go back through your projects and make sure you know the why behind every decision.",
        "The result is pending. Your fundamentals are okay, but a few layers of follow-up exposed some gaps. That's what to work on next.",
      ],
    },
    rejected: {
      zh: ['这次不太合适。不是能力的问题，是深度还没到。把一个技术点吃透，比会十个名词更有用。', '今天的结果不理想。建议你回去把自己做过的东西从原理上再过一遍，下次会不一样。'],
      en: [
        "This isn't the right fit this time. It's not about ability, it's depth. Understanding one thing thoroughly beats knowing ten buzzwords.",
        "Today didn't go your way. Go back and rework what you've built from first principles. Next time will be different.",
      ],
    },
  },
  expressions: {
    band: { great: ['smile', 'surprised'], good: ['neutral', 'smile'], ok: ['neutral'], weak: ['serious', 'thinking'], poor: ['serious', 'troubled'] },
    followup: ['serious', 'thinking'],
    main: ['neutral', 'serious'],
    reverse: 'neutral',
    closing: 'smile',
    special: { skipped: 'neutral', refusal: 'serious', dontKnow: 'thinking', manipulation: 'serious', joking: 'neutral', offLanguage: 'serious', long: 'thinking' },
  },
};
