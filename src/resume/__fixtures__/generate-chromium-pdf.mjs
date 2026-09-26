// Regenerate two-column-zh.pdf: a realistic two-column Chinese résumé printed by Chromium
// ("Save as PDF" is how most résumé builders export). Requires Playwright's Chromium and a CJK
// font (e.g. WenQuanYi Zen Hei).   node src/resume/__fixtures__/generate-chromium-pdf.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'WenQuanYi Zen Hei', sans-serif; font-size: 10.5pt; line-height: 1.55; color: #222; }
  header { padding: 18pt 28pt 12pt; border-bottom: 2pt solid #e67aa0; }
  header h1 { font-size: 22pt; letter-spacing: 2pt; }
  header p { color: #555; }
  .cols { display: flex; }
  aside { width: 32%; padding: 14pt 14pt 14pt 28pt; background: #fbeef3; min-height: 700pt; }
  main { width: 68%; padding: 14pt 28pt 14pt 18pt; }
  h2 { font-size: 12.5pt; color: #c2185b; margin: 10pt 0 4pt; }
  .row { display: flex; justify-content: space-between; font-weight: bold; }
  ul { padding-left: 14pt; }
</style></head><body>
<header><h1>林雨桐</h1><p>求职意向：Java 后端开发工程师 · 电话 137-0000-0000 · yutong.lin@example.com</p></header>
<div class="cols">
<aside>
  <h2>基本信息</h2><p>现居：上海</p><p>学历：硕士研究生</p><p>工作年限：2 年</p>
  <h2>专业技能</h2><ul><li>Java / Spring Cloud</li><li>MySQL 调优与分库分表</li><li>Redis 与缓存一致性</li><li>RocketMQ 消息可靠投递</li></ul>
  <h2>证书</h2><p>• 软件设计师（中级）</p><p>• CET-6 612 分</p>
</aside>
<main>
  <h2>教育背景</h2>
  <div class="row"><span>海川大学 · 软件工程 硕士</span><span>2021.09 – 2024.06</span></div>
  <p>研究方向：分布式事务；发表 EI 会议论文 1 篇。</p>
  <h2>工作经历</h2>
  <div class="row"><span>星河云科技 · 后端开发工程师</span><span>2024.07 – 至今</span></div>
  <ul><li>负责订单状态机服务重构，状态不一致工单下降 90%。</li><li>设计库存预扣方案，峰值 QPS 从 1.2 万提升到 3.5 万。</li></ul>
  <h2>项目经历</h2>
  <div class="row"><span>智能排班系统（负责人）</span><span>2023.03 – 2023.12</span></div>
  <ul><li>基于遗传算法生成排班方案，人工调整工作量减少 60%。</li><li>使用 Spring Boot + Vue 3 实现，服务 12 家门店。</li></ul>
</main>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.pdf({
  path: fileURLToPath(new URL('./two-column-zh.pdf', import.meta.url)),
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: '<div style="font-size:8pt;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  margin: { top: '20px', bottom: '40px', left: '0px', right: '0px' },
});
await browser.close();
console.log('two-column-zh.pdf written');
