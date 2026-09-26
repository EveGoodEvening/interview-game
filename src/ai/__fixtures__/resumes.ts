/** Test fixtures: realistic résumés (zh / en / thin / non-tech). */
export const ZH_RESUME = `张明远
求职意向：后端开发工程师
电话：13800138000 | 邮箱：mingyuan.zhang@example.com
教育背景
2019.09 - 2023.06 华中科技大学 计算机科学与技术 本科
工作经历
2023.07 - 至今 字节跳动 后端开发工程师
- 负责抖音电商订单系统的开发与维护，使用 Go、MySQL、Redis、Kafka
- 主导订单查询接口的缓存改造，P99 延迟从 320ms 降低到 80ms
- 推动核心服务接入全链路压测，支撑大促峰值 12 万 QPS
2022.06 - 2022.09 美团 后端开发实习生
- 参与商家结算平台开发，使用 Java、Spring Boot
- 编写对账脚本，将人工对账时间缩短 70%
项目经历
分布式任务调度平台 | 个人项目
- 基于 Go 和 etcd 实现的任务调度系统，支持 1000+ 任务并发调度
校园二手交易小程序
- 带领 4 人团队开发，上线后累计用户 3000 人
专业技能
熟悉 Go、Java，了解 Python；熟悉 MySQL、Redis、Kafka；了解 Docker、Kubernetes`;

export const EN_RESUME = `Emily Carter
Frontend Engineer
emily.carter@example.com | github.com/emilyc
EXPERIENCE
Shopify — Frontend Engineer, 2021 – Present
- Led the checkout redesign in React and TypeScript, improving conversion by 8%
- Built a design-system component library used by 12 teams
- Cut bundle size by 35% with code splitting and Vite migration
Acme Labs Inc. — Software Engineer Intern, Summer 2020
- Developed internal analytics dashboard with Vue and GraphQL
PROJECTS
Recipe Finder
- A PWA with offline support, 5k monthly users
EDUCATION
University of Toronto, B.S. Computer Science, 2021
SKILLS
React, TypeScript, Next.js, CSS, Node.js, Jest, Playwright, Figma`;

export const THIN_RESUME = '李华，应届毕业生，喜欢编程，学习能力强。';

export const MARKETING_RESUME = `王晓雨
求职意向：新媒体运营
2021.07 - 至今 某某文化传媒有限公司 新媒体运营
- 负责公司小红书和抖音账号的内容运营，半年内粉丝从 2 万增长到 15 万
- 策划 618 活动，带来 300 万曝光，转化率提升 25%
技能：内容运营、活动策划、数据分析、Photoshop`;
