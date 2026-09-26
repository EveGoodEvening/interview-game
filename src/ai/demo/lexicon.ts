/**
 * Skill / term dictionary (zh + en) used by the demo interviewer to read résumés and answers.
 */

export type FieldId =
  | 'frontend'
  | 'backend'
  | 'mobile'
  | 'data'
  | 'ai'
  | 'devops'
  | 'game'
  | 'product'
  | 'design'
  | 'marketing'
  | 'operations'
  | 'sales'
  | 'finance'
  | 'hr'
  | 'education'
  | 'general';

export interface SkillTerm {
  /** Display name used in generated questions. */
  name: string;
  /** zh display name, when different. */
  zh?: string;
  /** en display name, when `name` is Chinese (an English interview must never show Chinese terms). */
  en?: string;
  re: RegExp;
  tech: boolean;
  field: FieldId;
}

/** Latin term with non-alphanumeric boundaries (works for C++, Node.js, C#). */
function w(src: string, flags = 'i'): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])(?:${src})(?![A-Za-z0-9])`, flags);
}

export const SKILLS: readonly SkillTerm[] = [
  // Frontend
  { name: 'React', re: w('react(?:\\.js)?'), tech: true, field: 'frontend' },
  { name: 'Vue', re: w('vue(?:\\.?js)?(?:\\s?[23])?'), tech: true, field: 'frontend' },
  { name: 'Angular', re: w('angular'), tech: true, field: 'frontend' },
  { name: 'Svelte', re: w('svelte'), tech: true, field: 'frontend' },
  { name: 'Next.js', re: w('next\\.?js'), tech: true, field: 'frontend' },
  { name: 'TypeScript', re: w('typescript|ts(?=\\s*[/、,，])'), tech: true, field: 'frontend' },
  { name: 'JavaScript', re: w('javascript|es6'), tech: true, field: 'frontend' },
  { name: 'CSS', re: w('css3?|sass|scss|tailwind(?:css)?'), tech: true, field: 'frontend' },
  { name: 'Webpack', re: w('webpack'), tech: true, field: 'frontend' },
  { name: 'Vite', re: w('vite'), tech: true, field: 'frontend' },
  { name: 'WebGL', re: w('webgl|three\\.js'), tech: true, field: 'frontend' },
  { name: '微前端', zh: '微前端', en: 'micro-frontends', re: /微前端|micro[- ]?frontends?/i, tech: true, field: 'frontend' },
  { name: 'Electron', re: w('electron'), tech: true, field: 'frontend' },
  { name: '小程序', zh: '小程序', en: 'mini-programs', re: /小程序|mini[- ]?programs?/i, tech: true, field: 'frontend' },
  // Backend
  { name: 'Java', re: w('java(?!\\s*script)'), tech: true, field: 'backend' },
  { name: 'Spring Boot', re: /(?<![A-Za-z0-9])(?:spring\s?boot|spring\s?cloud|spring\s?mvc|spring(?!\s*(?:\d|semester|term|break)))(?![A-Za-z0-9])/i, tech: true, field: 'backend' },
  { name: 'Go', re: /(?<![A-Za-z])(?:Golang|golang|Go)(?![A-Za-z-])/, tech: true, field: 'backend' },
  { name: 'Python', re: w('python'), tech: true, field: 'backend' },
  { name: 'Node.js', re: w('node(?:\\.?js)?'), tech: true, field: 'backend' },
  { name: 'C++', re: w('c\\+\\+'), tech: true, field: 'backend' },
  { name: 'C#', re: w('c#|\\.net'), tech: true, field: 'backend' },
  { name: 'Rust', re: w('rust'), tech: true, field: 'backend' },
  { name: 'PHP', re: w('php'), tech: true, field: 'backend' },
  { name: 'Django', re: w('django|flask|fastapi'), tech: true, field: 'backend' },
  { name: 'MySQL', re: w('mysql'), tech: true, field: 'backend' },
  { name: 'PostgreSQL', re: w('postgres(?:ql)?'), tech: true, field: 'backend' },
  { name: 'Redis', re: w('redis'), tech: true, field: 'backend' },
  { name: 'MongoDB', re: w('mongo(?:db)?'), tech: true, field: 'backend' },
  { name: 'Elasticsearch', re: w('elasticsearch|elastic\\s?search'), tech: true, field: 'backend' },
  { name: 'Kafka', re: w('kafka'), tech: true, field: 'backend' },
  { name: 'RabbitMQ', re: w('rabbitmq|rocketmq'), tech: true, field: 'backend' },
  { name: 'gRPC', re: w('grpc|thrift|dubbo'), tech: true, field: 'backend' },
  { name: 'GraphQL', re: w('graphql'), tech: true, field: 'backend' },
  { name: '微服务', zh: '微服务', en: 'microservices', re: /微服务|micro-?services?/i, tech: true, field: 'backend' },
  { name: '分布式', zh: '分布式', en: 'distributed systems', re: /分布式|distributed systems?/i, tech: true, field: 'backend' },
  { name: '高并发', zh: '高并发', en: 'high concurrency', re: /高并发|high[- ]concurrency/i, tech: true, field: 'backend' },
  { name: '消息队列', zh: '消息队列', en: 'message queues', re: /消息队列|message queues?/i, tech: true, field: 'backend' },
  { name: '缓存', zh: '缓存', en: 'caching', re: /缓存|caching/i, tech: true, field: 'backend' },
  // Mobile
  { name: 'Android', re: w('android'), tech: true, field: 'mobile' },
  { name: 'iOS', re: w('ios'), tech: true, field: 'mobile' },
  { name: 'Swift', re: w('swift(?:ui)?'), tech: true, field: 'mobile' },
  { name: 'Kotlin', re: w('kotlin'), tech: true, field: 'mobile' },
  { name: 'Flutter', re: w('flutter'), tech: true, field: 'mobile' },
  { name: 'React Native', re: w('react\\s?native'), tech: true, field: 'mobile' },
  // DevOps / infra
  { name: 'Docker', re: w('docker'), tech: true, field: 'devops' },
  { name: 'Kubernetes', re: w('kubernetes|k8s'), tech: true, field: 'devops' },
  { name: 'Linux', re: w('linux'), tech: true, field: 'devops' },
  { name: 'AWS', re: w('aws|amazon web services'), tech: true, field: 'devops' },
  { name: '阿里云', zh: '阿里云', en: 'Alibaba Cloud', re: /阿里云|aliyun/i, tech: true, field: 'devops' },
  { name: 'CI/CD', re: /ci\s?\/\s?cd|jenkins|github actions/i, tech: true, field: 'devops' },
  { name: 'Nginx', re: w('nginx'), tech: true, field: 'devops' },
  { name: 'Prometheus', re: w('prometheus|grafana'), tech: true, field: 'devops' },
  { name: 'Terraform', re: w('terraform'), tech: true, field: 'devops' },
  // Data / AI
  { name: 'SQL', re: w('sql'), tech: true, field: 'data' },
  { name: 'Spark', re: w('spark|hadoop|hive|flink'), tech: true, field: 'data' },
  { name: 'ClickHouse', re: w('clickhouse'), tech: true, field: 'data' },
  { name: 'Pandas', re: w('pandas|numpy'), tech: true, field: 'data' },
  { name: 'Tableau', re: w('tableau|power\\s?bi'), tech: true, field: 'data' },
  { name: '数据分析', zh: '数据分析', en: 'data analysis', re: /数据分析|data analy(?:sis|tics)/i, tech: false, field: 'data' },
  { name: 'A/B 测试', zh: 'A/B 测试', en: 'A/B testing', re: /a\s?\/\s?b\s?(?:测试|test(?:ing)?)|ab\s?test/i, tech: false, field: 'data' },
  { name: 'PyTorch', re: w('pytorch|torch'), tech: true, field: 'ai' },
  { name: 'TensorFlow', re: w('tensorflow|keras'), tech: true, field: 'ai' },
  { name: '机器学习', zh: '机器学习', en: 'machine learning', re: /机器学习|machine learning|\bML\b/i, tech: true, field: 'ai' },
  { name: '深度学习', zh: '深度学习', en: 'deep learning', re: /深度学习|deep learning/i, tech: true, field: 'ai' },
  { name: '大模型', zh: '大模型', en: 'LLMs', re: /大模型|大语言模型|\bLLMs?\b|\bGPT\b|transformer/i, tech: true, field: 'ai' },
  { name: 'RAG', re: w('rag'), tech: true, field: 'ai' },
  { name: 'NLP', re: /自然语言处理|\bNLP\b/i, tech: true, field: 'ai' },
  { name: '计算机视觉', zh: '计算机视觉', en: 'computer vision', re: /计算机视觉|computer vision|opencv/i, tech: true, field: 'ai' },
  { name: '推荐系统', zh: '推荐系统', en: 'recommender systems', re: /推荐系统|推荐算法|recommend(?:er|ation) systems?/i, tech: true, field: 'ai' },
  // Game
  { name: 'Unity', re: w('unity(?:3d)?'), tech: true, field: 'game' },
  { name: 'Unreal', re: w('unreal|ue[45]'), tech: true, field: 'game' },
  // Product / design
  { name: '需求分析', zh: '需求分析', en: 'requirements analysis', re: /需求分析|requirements? analysis/i, tech: false, field: 'product' },
  { name: '用户研究', zh: '用户研究', en: 'user research', re: /用户研究|用户调研|user research/i, tech: false, field: 'product' },
  { name: 'PRD', re: w('prd'), tech: false, field: 'product' },
  { name: '产品设计', zh: '产品设计', en: 'product design', re: /产品设计|product design/i, tech: false, field: 'product' },
  { name: '项目管理', zh: '项目管理', en: 'project management', re: /项目管理|project management|\bPMP\b|scrum|敏捷/i, tech: false, field: 'product' },
  { name: 'Figma', re: w('figma|sketch'), tech: false, field: 'design' },
  { name: 'Photoshop', re: w('photoshop|\\bps\\b|illustrator|after effects'), tech: false, field: 'design' },
  { name: '交互设计', zh: '交互设计', en: 'interaction design', re: /交互设计|interaction design|\bUX\b|用户体验/i, tech: false, field: 'design' },
  { name: '视觉设计', zh: '视觉设计', en: 'visual design', re: /视觉设计|visual design|\bUI\s?设计|UI design/i, tech: false, field: 'design' },
  // Business
  { name: '用户增长', zh: '用户增长', en: 'user growth', re: /用户增长|增长黑客|growth hacking|user growth/i, tech: false, field: 'marketing' },
  { name: '市场营销', zh: '市场营销', en: 'marketing', re: /市场营销|营销策划|marketing/i, tech: false, field: 'marketing' },
  { name: '品牌', zh: '品牌', en: 'branding', re: /品牌(?:建设|推广|策划)|brand(?:ing)?/i, tech: false, field: 'marketing' },
  { name: 'SEO', re: w('seo|sem'), tech: false, field: 'marketing' },
  { name: '新媒体', zh: '新媒体', en: 'social media', re: /新媒体|社交媒体|social media|(?:小红书|抖音|公众号|微博|B站)(?:运营|账号|内容|博主)/i, tech: false, field: 'marketing' },
  { name: '内容运营', zh: '内容运营', en: 'content operations', re: /内容运营|content (?:operations|marketing)|copywriting|文案/i, tech: false, field: 'operations' },
  { name: '用户运营', zh: '用户运营', en: 'community operations', re: /用户运营|社群运营|community (?:management|operations)/i, tech: false, field: 'operations' },
  { name: '活动运营', zh: '活动运营', en: 'event operations', re: /活动运营|活动策划|event (?:planning|operations)/i, tech: false, field: 'operations' },
  { name: '电商运营', zh: '电商运营', en: 'e-commerce operations', re: /电商运营|店铺运营|e-?commerce operations/i, tech: false, field: 'operations' },
  { name: '销售', zh: '销售', en: 'sales', re: /销售|大客户|\bsales\b|key accounts?/i, tech: false, field: 'sales' },
  { name: '商务拓展', zh: '商务拓展', en: 'business development', re: /商务拓展|\bBD\b|business development/i, tech: false, field: 'sales' },
  { name: '客户成功', zh: '客户成功', en: 'customer success', re: /客户成功|customer success|客户关系|\bCRM\b/i, tech: false, field: 'sales' },
  { name: '财务分析', zh: '财务分析', en: 'financial analysis', re: /财务分析|财务|financial (?:analysis|modeling)|\bFP&A\b/i, tech: false, field: 'finance' },
  { name: '会计', zh: '会计', en: 'accounting', re: /会计|审计|税务|accounting|audit|\bCPA\b/i, tech: false, field: 'finance' },
  { name: 'Excel', re: w('excel|vba'), tech: false, field: 'finance' },
  { name: '招聘', zh: '招聘', en: 'recruiting', re: /招聘|recruit(?:ing|ment)|talent acquisition/i, tech: false, field: 'hr' },
  { name: '培训', zh: '培训', en: 'training and development', re: /培训体系|员工培训|learning (?:and|&) development/i, tech: false, field: 'hr' },
  { name: '教学', zh: '教学', en: 'teaching', re: /教学|授课|课程设计|teaching|curriculum/i, tech: false, field: 'education' },
];

/** Skills found in `text`, in order of first appearance, de-duplicated by display name. */
export function findSkills(text: string): SkillTerm[] {
  const hits: { term: SkillTerm; index: number }[] = [];
  for (const term of SKILLS) {
    const m = term.re.exec(text);
    if (m) hits.push({ term, index: m.index });
  }
  hits.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const out: SkillTerm[] = [];
  for (const h of hits) {
    if (seen.has(h.term.name)) continue;
    seen.add(h.term.name);
    out.push(h.term);
  }
  // "React Native" also matches "React"; drop the shorter one when the longer is present.
  return out.filter((t) => !(t.name === 'React' && seen.has('React Native')));
}

export function skillDisplay(term: SkillTerm, lang: 'zh' | 'en'): string {
  return lang === 'zh' ? (term.zh ?? term.name) : (term.en ?? term.name);
}

export const KNOWN_COMPANIES: readonly string[] = [
  '字节跳动', '腾讯', '阿里巴巴', '阿里', '蚂蚁集团', '美团', '京东', '百度', '华为', '小米', '网易', '拼多多', '快手', '滴滴',
  '哔哩哔哩', 'B站', '携程', '小红书', '米哈游', '大疆', '蔚来', '理想汽车', '比亚迪', '中兴', '联想', '顺丰', '招商银行', '平安',
  'Google', 'Microsoft', 'Amazon', 'Meta', 'Apple', 'Netflix', 'ByteDance', 'TikTok', 'Tencent', 'Alibaba', 'Shopify', 'Stripe',
  'Airbnb', 'Uber', 'Spotify', 'Salesforce', 'Oracle', 'IBM', 'Intel', 'NVIDIA', 'Adobe', 'LinkedIn', 'Twitter', 'Atlassian',
  'Deloitte', 'PwC', 'EY', 'KPMG', 'McKinsey', 'BCG', 'Accenture',
];
