/**
 * Shared (character-neutral) question phrasings for the offline interviewer.
 * Placeholders: {project} {skill} {metric} {company} {school} {role} {title} {us} (interviewer's company).
 */
import type { Lines, QuestionCategory } from './types';

export const SHARED_QUESTIONS: Record<QuestionCategory, Lines> = {
  project: {
    zh: [
      '你简历里写了{project}，能挑一个最关键的难点讲讲吗？当时是什么情况，你具体做了什么，结果怎么样？',
      '我对{project}挺感兴趣的。能从背景讲起，说说你在里面负责什么，最后做出了什么效果吗？',
    ],
    en: [
      'Your résumé mentions {project}. Could you pick the hardest part of it and walk me through the situation, what you did, and how it turned out?',
      "I'm curious about {project}. Can you give me the background, your role in it, and the impact it had?",
    ],
  },
  skill: {
    zh: ['你在简历里提到了{skill}，能说一个你真正用{skill}解决问题的例子吗？', '说说你对{skill}的理解吧，最好结合一次你实际踩过的坑。'],
    en: [
      'You list {skill} on your résumé. Can you give me an example where you really used it to solve a problem?',
      'Tell me how well you know {skill}, ideally through a pitfall you actually ran into.',
    ],
  },
  metric: {
    zh: ['简历上写着“{metric}”，这个结果是怎么做出来的？又是怎么衡量的？', '我注意到“{metric}”这一条。能拆开讲讲吗，你做了哪些关键动作，这个数字是怎么算出来的？'],
    en: [
      'Your résumé says "{metric}". How did you achieve that, and how was it measured?',
      'I noticed "{metric}". Can you break it down for me: what were the key things you did, and how was that number calculated?',
    ],
  },
  company: {
    zh: ['你在{company}的这段经历里，最有挑战的一件事是什么？你是怎么处理的？', '在{company}工作期间，你觉得自己成长最大的是哪方面？能用一件具体的事来说明吗？'],
    en: [
      'During your time at {company}, what was the most challenging thing you dealt with, and how did you handle it?',
      'What did you grow the most in while you were at {company}? Can you illustrate it with a specific story?',
    ],
  },
  school: {
    zh: ['在{school}读书的时候，有没有哪门课或者哪个项目，让你真正想做这一行？', '说说你在{school}期间最投入的一段经历吧，你从里面学到了什么？'],
    en: [
      'While you were at {school}, was there a course or project that really made you want to do this kind of work?',
      'Tell me about the experience at {school} that you threw yourself into the most. What did you learn from it?',
    ],
  },
  jdMatch: {
    zh: ['我们这个岗位很看重{skill}。你在这方面最能拿得出手的一次经历是什么？', '职位描述里提到了{skill}，能结合你的经历说说你在这方面做到了什么程度吗？'],
    en: ["This role puts a lot of weight on {skill}. What's your strongest experience with it?", 'The job description mentions {skill}. How far have you taken it in your own work?'],
  },
  jdGap: {
    zh: ['职位要求里有{skill}，但我在你简历上没怎么看到。如果入职后马上要用，你打算怎么补上？', '{skill}是这个岗位的重要部分，你简历上似乎还没有相关经历。你会怎么快速上手？'],
    en: [
      "The role requires {skill}, but I don't see much of it on your résumé. If you needed it on day one, how would you close that gap?",
      "{skill} is a big part of this job and it doesn't really show up on your résumé yet. How would you get up to speed quickly?",
    ],
  },
  thin: {
    zh: ['你的简历写得比较简洁，所以我想请你自己挑一段最能代表你的经历，详细讲讲。', '简历上的信息不算多。能说一件你做过的、最能体现你能力的事情吗？越具体越好。'],
    en: [
      "Your résumé is fairly brief, so I'd like you to pick the one experience that best represents you and walk me through it in detail.",
      "There isn't a lot on your résumé yet. Tell me about one thing you've done that best shows what you're capable of, as specifically as you can.",
    ],
  },
  role: {
    zh: ['在你看来，一个优秀的{role}和一个普通的{role}，最大的区别是什么？你现在处在哪个位置？', '你为什么想做{role}？你觉得自己最适合这个岗位的一点是什么？'],
    en: ['In your view, what separates a great {role} from an average one? And where are you today?', 'Why do you want to be a {role}? What makes you a good fit for it?'],
  },
  custom: {
    zh: ['接下来想聊聊「{title}」。能结合你的具体经历说说吗？'],
    en: ["Next, I'd like to talk about {title}. Could you walk me through a concrete experience of yours?"],
  },
  proudest: {
    zh: ['到目前为止，你最有成就感的一件事是什么？你在里面起了什么作用？', '如果只能挑一件事来证明你的能力，你会讲哪一件？'],
    en: ["What's the accomplishment you're proudest of so far, and what was your part in it?", 'If you could pick just one thing to prove what you can do, what would it be?'],
  },
  challenge: {
    zh: ['说一个你遇到过的最棘手的问题吧，你是怎么一步步把它解决的？', '你经历过最难的一段时间是什么时候？当时是怎么扛过来的？'],
    en: [
      "Tell me about the toughest problem you've faced. How did you work through it step by step?",
      "What was the hardest stretch you've been through at work or school, and how did you get through it?",
    ],
  },
  teamwork: {
    zh: ['有没有和同事意见不合的时候？当时分歧在哪儿，最后怎么解决的？', '讲一次你和团队一起完成一件难事的经历，你在团队里扮演什么角色？'],
    en: [
      'Tell me about a time you disagreed with a teammate. What was the disagreement, and how was it resolved?',
      'Describe a time your team pulled off something difficult together. What role did you play?',
    ],
  },
  failure: {
    zh: ['能说一次你搞砸了的经历吗？后来你是怎么复盘和弥补的？', '有没有哪件事，你现在回头看会用完全不同的方式去做？'],
    en: ['Tell me about a time you got something wrong. How did you review it and make up for it?', "Is there something you'd do completely differently if you could do it again?"],
  },
  learning: {
    zh: ['最近一次你需要在很短时间内学会一样新东西，是什么情况？你是怎么学的？', '你平时是怎么保持学习的？举一个最近学到并且用上的例子。'],
    en: [
      'Tell me about the last time you had to learn something new very quickly. How did you go about it?',
      'How do you keep learning? Give me a recent example of something you learned and actually used.',
    ],
  },
  pressure: {
    zh: ['说一次截止时间特别紧、压力特别大的经历，你是怎么安排优先级的？', '如果同时有三件急事压在你身上，你会怎么处理？能结合真实经历说说吗？'],
    en: ['Tell me about a time you were under a really tight deadline. How did you prioritise?', 'When three urgent things land on you at once, what do you do? Can you tie it to a real experience?'],
  },
  motivation: {
    zh: ['你为什么想来{us}？这个岗位最吸引你的是什么？', '你这次找工作，最看重的是什么？{us}哪一点让你觉得合适？'],
    en: ['Why do you want to join {us}? What draws you to this role?', 'What matters most to you in your next job, and what about {us} feels like a fit?'],
  },
  career: {
    zh: ['你对未来三到五年有什么规划？这个岗位在里面扮演什么角色？', '五年后你希望自己成为一个什么样的人？为了这个目标你现在在做什么？'],
    en: [
      'Where do you see yourself in three to five years, and how does this role fit into that?',
      'Who do you want to be five years from now, and what are you doing today to get there?',
    ],
  },
  strengths: {
    zh: ['你觉得自己最大的优点和最需要改进的地方分别是什么？为了改进你做了什么？', '如果请你的前同事评价你，他们会怎么说你的长处和短板？'],
    en: [
      "What's your biggest strength, and what's the area you most need to improve? What are you doing about it?",
      'If I called your former teammates, what would they say about your strengths and weaknesses?',
    ],
  },
  debugging: {
    zh: ['讲一个你排查过的最棘手的问题，你是怎么一步步定位到根因的？', '线上出过什么让你印象深刻的故障吗？从发现到解决，你是怎么做的？'],
    en: [
      "Walk me through the nastiest bug or issue you've tracked down. How did you find the root cause?",
      'Tell me about a production incident that stuck with you. What did you do from detection to fix?',
    ],
  },
  design: {
    zh: ['如果让你从零设计你最熟悉的那个系统，你会怎么做？关键的取舍是什么？', '你做过的方案里，哪一个的技术取舍最难？当时考虑了哪些选项？'],
    en: [
      'If you had to redesign the system you know best from scratch, how would you approach it, and what are the key trade-offs?',
      'Which design decision in your work involved the hardest trade-off? What options did you weigh?',
    ],
  },
  quality: {
    zh: ['你怎么保证自己交付的东西质量过关？能说说你的具体做法吗？', '你怎么看待写测试和代码评审？有没有因为它们避免过一次事故？'],
    en: ['How do you make sure what you deliver is high quality? What do you actually do?', 'How do you think about testing and code review? Has either ever saved you from a real incident?'],
  },
  ownership: {
    zh: ['有没有一件事，本来不是你的职责，但你主动把它推动下来了？', '说一次你在没有人安排的情况下，自己发现问题并解决它的经历。'],
    en: ["Tell me about something that wasn't your job, but you drove it anyway.", 'Describe a time you spotted a problem nobody asked you to fix, and fixed it.'],
  },
  prioritize: {
    zh: ['如果时间和人手只够做一半的需求，你会怎么决定先做什么？', '说一次你不得不砍掉一些事情的经历，你是怎么做取舍、又是怎么跟别人沟通的？'],
    en: [
      'If you only had the time and people for half of the requests, how would you decide what to do first?',
      'Tell me about a time you had to cut scope. How did you decide, and how did you communicate it?',
    ],
  },
  scenario: {
    zh: ['假设你明天入职，接手的第一个项目就已经延期了，你前两周会怎么做？', '如果让你用一个月时间，给{us}的产品做一次改进，你会从哪里下手？'],
    en: [
      'Say you join tomorrow and the first project you inherit is already late. What do you do in your first two weeks?',
      "If you had one month to improve one thing about {us}'s product, where would you start?",
    ],
  },
};
