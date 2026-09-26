/**
 * Built-in sample résumés (fictional people, companies and contact details) so players can try
 * the game instantly. They are detailed on purpose: concrete projects, numbers and technologies
 * give both the LLM and the offline demo interviewer something specific to ask about.
 */
import type { Lang } from '../types';

const ZH_RESUME = `张晓明
求职意向：后端开发工程师 / 全栈开发工程师（2026 届本科）
电话：138-0000-0000 ｜ 邮箱：zhangxm@example.com ｜ GitHub：github.com/zhangxm-dev ｜ 现居：杭州

【教育背景】
明德理工大学 · 计算机科学与技术（本科）  2022.09 – 2026.06
- GPA 3.72 / 4.0（专业前 10%），连续两年获校一等奖学金
- 主修课程：数据结构与算法、操作系统、计算机网络、数据库系统、分布式系统导论
- ACM-ICPC 亚洲区域赛铜奖；校 ACM 集训队队员（2023–2024）

【实习经历】
星河云科技有限公司 · 后端开发实习生（订单中台组）  2025.06 – 2025.12
- 主导订单状态机服务重构：把分散在 6 个服务中的状态流转收敛为统一状态机 + 事件表，线上“状态不一致”工单从每周约 40 单降到 3 单以内
- 为大促下单链路设计 Redis + Lua 库存预扣方案，配合本地缓存与令牌桶限流，压测峰值 QPS 从 1.2 万提升到 3.5 万，P99 延迟由 180ms 降至 65ms
- 引入 Kafka 事务消息 + 每小时对账任务，解决支付回调丢失导致的“已付款未发货”问题（月均 120+ 单降为 0）
- 补齐接口契约测试与压测脚本，负责模块的单元测试覆盖率从 35% 提升到 78%

云帆数据科技 · 全栈开发实习生（数据产品部）  2024.07 – 2024.09
- 使用 React + TypeScript 开发内部 BI 看板配置平台，支持拖拽搭建报表；上线后运营自助建表占比从 20% 提升到 65%
- 基于 Node.js（NestJS）实现报表查询网关，增加 SQL 模板化与结果缓存，平均查询耗时从 4.2s 降到 1.1s
- 参与前端性能优化：路由懒加载 + 虚拟列表，万行表格滚动帧率从约 20fps 提升到接近 60fps

【项目经历】
青柚集市 —— 校园二手交易小程序（项目负责人，4 人团队）  2023.10 – 2024.05
- 技术栈：Go（Gin）+ MySQL + Redis + 微信小程序；负责整体架构设计以及交易、消息两个模块
- 实现基于 WebSocket 的买卖双方即时聊天与离线消息推送，消息送达率 99.9%
- 商品搜索从 MySQL 全文索引迁移到 Elasticsearch，搜索响应从 800ms 降到 120ms
- 上线一学期注册用户 8,600+，日活峰值 2,100，累计成交 3,400+ 单；获校“互联网+”创新创业大赛二等奖

Flowline —— 轻量级分布式任务调度系统（个人开源项目）  2024.10 – 至今
- 使用 Go 实现，基于 etcd 做选主与服务发现，支持 Cron、延时任务和 DAG 依赖编排
- 采用分层时间轮 + 任务分片，3 节点集群稳定调度 10 万级任务/天，调度误差小于 1 秒
- 实现失败重试、幂等执行与执行日志链路追踪；GitHub 获得 420+ Star，合并外部 PR 12 个

分布式 KV 存储（课程项目，基于 Raft 协议）  2024.03 – 2024.06
- 实现 Leader 选举、日志复制、快照压缩与线性一致读，通过全部 2,000 次随机故障注入测试

【专业技能】
- 语言：Go（熟练）、Java / Spring Boot（熟悉）、TypeScript / JavaScript（熟练）、Python（日常脚本）
- 后端：MySQL（索引优化、事务与锁）、Redis（缓存设计、分布式锁）、Kafka、gRPC、Elasticsearch
- 前端：React、Next.js、Vite；了解 Web 性能优化与前端工程化
- 工程：Docker、Kubernetes 基础、GitHub Actions CI/CD、Prometheus + Grafana 监控、Linux
- 英语：CET-6（586 分），可流畅阅读英文技术文档

【其他】
- 技术博客“晓明的后端笔记”累计发布 60+ 篇文章，总阅读量 15 万+
- 学院技术社团副社长，组织 8 场技术分享会，累计参与 500+ 人次
`;

const EN_RESUME = `Alex Chen
Frontend / Product Engineer · 3 years of experience
Seattle, WA · alex.chen@example.com · (555) 010-0142 · github.com/alexchen-dev

SUMMARY
Product-minded frontend engineer who ships measurable improvements to B2B SaaS products.
Strong in React and TypeScript, design systems, web performance and experiment-driven product work.

EXPERIENCE
Brightloop Analytics — Frontend Engineer II, Growth & Onboarding  (Mar 2025 – Present)
- Led the rebuild of the onboarding flow (React, TypeScript, XState); trial-to-activation rate rose from 31% to 44% across ~12k monthly sign-ups
- Designed and analysed 14 A/B tests with product and design; 5 shipped, adding an estimated $1.2M in ARR
- Cut dashboard Largest Contentful Paint from 4.1s to 1.6s (route-level code splitting, streaming SSR, request de-duplication); bounce rate fell 18%
- Mentor two junior engineers; introduced a lightweight RFC process now used by 4 frontend teams

Brightloop Analytics — Frontend Engineer  (Jul 2023 – Feb 2025)
- Built "Prism", the company design system: 48 accessible React components, Storybook docs and visual regression tests, adopted by 6 product teams
- Took the core app to WCAG 2.1 AA — fixed 300+ accessibility issues, which unblocked two enterprise deals that required a VPAT
- Migrated 180k lines of JavaScript to TypeScript with codemods; production runtime errors dropped 37%
- Owned the CSV import wizard end to end; import-related support tickets went from ~90 to 25 per month

Pixelwise Studio — Software Engineering Intern  (Jun 2022 – Sep 2022)
- Shipped real-time collaborative annotations for the design editor (WebSockets, Yjs CRDT), used by 2,000+ designers in the first month
- Added Playwright end-to-end tests for the editor, reducing release regressions from about 6 to 1 per sprint

PROJECTS
Tabletop Tally — offline-first PWA for board-game scoring (side project)
- React, IndexedDB and a service worker with background sync; 9k monthly active users, 4.8★ from 600+ reviews
- Wrote a post about its conflict-free sync design that reached the front page of Hacker News

Open source — contributor to a popular React form library
- Fixed a field-array re-render bug (about 40% fewer renders in large forms); 7 merged pull requests

EDUCATION
Lakeshore State University — B.S. Computer Science, minor in Cognitive Science  (2019 – 2023)
- GPA 3.8 / 4.0 · Dean's List for 6 semesters · Teaching assistant for Human-Computer Interaction

SKILLS
- Languages: TypeScript, JavaScript, HTML/CSS, Python, SQL
- Frontend: React, Next.js, React Query, Redux Toolkit, XState, Tailwind CSS, Storybook, Vite
- Quality: Playwright, Vitest/Jest, Testing Library, Lighthouse CI, axe accessibility audits
- Backend & tooling: Node.js, GraphQL, PostgreSQL, AWS (Lambda, CloudFront), Docker, GitHub Actions
- Product: A/B testing and experiment design, product analytics, user interviews, writing specs
`;

export const SAMPLE_RESUMES: Record<Lang, { fileName: string; text: string }> = {
  zh: { fileName: '示例简历.txt', text: ZH_RESUME.trim() },
  en: { fileName: 'sample-resume.txt', text: EN_RESUME.trim() },
};
