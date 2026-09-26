/**
 * A tiny OpenAI-compatible server for the E2E run (node:http, ports 5450–5459).
 *
 * POST /v1/chat/completions answers with valid interviewer JSON for the detected request kind
 * (plan / turn / report / connection test, see detectKind).
 * Requests without `Authorization: Bearer <apiKey>` get a provider-style 401 (models and chat alike);
 * `failWith(status)` makes every chat request fail until `succeed()`.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type RequestKind = 'plan' | 'turn' | 'report' | 'test' | 'models' | 'other';

export interface MockRequest {
  kind: RequestKind;
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown> | null;
}

export interface MockLlm {
  readonly port: number;
  /** e.g. http://127.0.0.1:5451/v1 */
  readonly baseUrl: string;
  readonly requests: MockRequest[];
  failWith(status: number): void;
  succeed(): void;
  close(): Promise<void>;
}

/**
 * Which interviewer call this is. With `response_format: json_object` the prompt has to spell out
 * the JSON shape, so the field names are a stable marker (token budgets are tuned too often to key
 * on). Checked from the most to the least specific.
 */
function detectKind(body: Record<string, unknown>): RequestKind {
  const text = JSON.stringify(body.messages ?? '');
  if (/connectivity check|reply with exactly OK/i.test(text)) return 'test';
  if (/questionReviews/.test(text)) return 'report';
  if (/affinityDelta/.test(text)) return 'turn';
  if (/topics/.test(text)) return 'plan';
  return 'other';
}

let turnCounter = 0;

type TurnKind = 'main' | 'followup' | 'reverse_prompt' | 'reverse_answer' | 'closing';

/**
 * The kind this turn should have: the turn instructions (last user message) name the allowed kinds
 * in quotes. Prefer moving on over a follow-up (keeps the run short), else the first one named.
 * Unknown wording → "main"; the interviewer then retries once and the engine coerces the kind.
 */
function turnKind(body: Record<string, unknown>): TurnKind {
  const messages = Array.isArray(body.messages) ? (body.messages as { role?: string; content?: unknown }[]) : [];
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const text = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');
  const named = [...text.matchAll(/"(main|followup|reverse_prompt|reverse_answer|closing)"/g)].map((m) => m[1] as TurnKind);
  return named.find((k) => k !== 'followup') ?? named[0] ?? 'main';
}

const TURN_TEXT: Record<TurnKind, { reaction: string; question: string }> = {
  main: { reaction: '嗯，这个回答很具体。', question: '能具体说说你在这个项目里最难的一个技术决策吗？' },
  followup: { reaction: '有意思。', question: '当时为什么选择这个方案，而不是别的？' },
  reverse_prompt: { reaction: '我的问题就到这里。', question: '关于我们公司或者这个岗位，你有什么想问我的吗？' },
  reverse_answer: { reaction: '我们团队以 Go 和 TypeScript 为主，新人会有导师带三个月。', question: '你还有别的问题吗？' },
  closing: { reaction: '今天就到这里，谢谢你的时间，我们会在一周内通知你结果，再见。', question: '' },
};

/** Chinese interviewer JSON for each request kind. */
function reply(kind: RequestKind, body: Record<string, unknown>): unknown {
  switch (kind) {
    case 'plan':
      return {
        candidateName: '张晓明',
        targetRole: '后端开发工程师',
        summary: '有两段后端实习，项目指标清晰，值得深挖。',
        highlights: ['订单服务重构', '高并发优化'],
        concerns: ['团队协作经历偏少'],
        topics: [
          { title: '订单服务重构', goal: '了解架构取舍' },
          { title: '高并发优化', goal: '验证性能调优的深度' },
          { title: '团队协作', goal: '了解沟通方式' },
        ],
        opening: { speech: '你好，我是今天的面试官，模拟大模型已经读完你的简历了。先请你做个简单的自我介绍吧？', expression: 'smile' },
      };
    case 'turn': {
      turnCounter++;
      const kind = turnKind(body);
      return {
        assessment: { score: 8, comment: `回答具体，有数据支撑（第 ${turnCounter} 轮）。`, affinityDelta: 4 },
        kind,
        ...TURN_TEXT[kind],
        expression: 'smile',
      };
    }
    case 'report':
      return {
        overallScore: 84,
        dimensions: [
          { key: 'communication', score: 82, comment: '表达清楚' },
          { key: 'expertise', score: 86, comment: '基础扎实' },
          { key: 'logic', score: 80, comment: '条理清晰' },
          { key: 'impact', score: 88, comment: '成果量化' },
          { key: 'fit', score: 83, comment: '匹配度高' },
        ],
        strengths: ['回答有数据支撑', '项目经验扎实'],
        improvements: ['可以多讲讲团队协作'],
        questionReviews: [],
        summary: '模拟大模型给出的总评：整体表现不错。',
        finalMessage: '今天聊得很愉快，我们会尽快联系你。',
      };
    case 'test':
      return 'OK';
    default:
      return {};
  }
}

function completion(content: string, model: string) {
  return {
    id: `chatcmpl-e2e-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
}

/**
 * Start the mock on the first free port of `ports` (a range, so parallel workers / --repeat-each
 * never collide).
 */
export async function startMockLlm(ports: readonly number[], apiKey: string): Promise<MockLlm> {
  const requests: MockRequest[] = [];
  let failure: number | null = null;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: Record<string, unknown> | null;
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      } catch {
        body = null;
      }
      const url = req.url ?? '/';
      const send = (status: number, payload: unknown) => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(payload));
      };

      if (req.headers.authorization !== `Bearer ${apiKey}`) {
        requests.push({ kind: body ? detectKind(body) : 'models', method: req.method ?? '', url, headers: req.headers, body });
        send(401, { error: { message: 'Incorrect API key provided: sk-***.', type: 'invalid_request_error', code: 'invalid_api_key' } });
        return;
      }
      if (req.method === 'GET' && url.endsWith('/models')) {
        requests.push({ kind: 'models', method: 'GET', url, headers: req.headers, body: null });
        send(200, { object: 'list', data: [{ id: 'mock-model', object: 'model' }, { id: 'mock-model-mini', object: 'model' }] });
        return;
      }
      if (req.method !== 'POST' || !url.endsWith('/chat/completions') || !body) {
        requests.push({ kind: 'other', method: req.method ?? '', url, headers: req.headers, body });
        send(404, { error: { message: `No route for ${req.method} ${url}`, type: 'invalid_request_error' } });
        return;
      }
      const kind = detectKind(body);
      requests.push({ kind, method: 'POST', url, headers: req.headers, body });
      if (failure !== null) {
        const auth = failure === 401 || failure === 403;
        send(failure, {
          error: auth
            ? { message: 'Incorrect API key provided: sk-e2e-***.', type: 'invalid_request_error', code: 'invalid_api_key' }
            : { message: `Mock failure ${failure}`, type: 'server_error' },
        });
        return;
      }
      const content = reply(kind, body);
      send(200, completion(typeof content === 'string' ? content : JSON.stringify(content), String(body.model ?? 'mock-model')));
    });
  });

  const listen = (port: number) =>
    new Promise<boolean>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => (err.code === 'EADDRINUSE' ? resolve(false) : reject(err));
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', onError);
        resolve(true);
      });
    });
  let bound = false;
  for (const port of ports) if ((bound = await listen(port))) break;
  if (!bound) throw new Error(`No free port for the mock LLM in ${ports.join(', ')}`);
  const actual = (server.address() as AddressInfo).port;

  return {
    port: actual,
    baseUrl: `http://127.0.0.1:${actual}/v1`,
    requests,
    failWith: (status) => {
      failure = status;
    },
    succeed: () => {
      failure = null;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
