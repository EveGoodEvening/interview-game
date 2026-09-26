/** Scripted ChatProvider for tests: returns queued replies (or throws queued errors) in order. */
import type { ChatProvider, ChatRequest, ChatResult } from '../../llm/types';

export type ScriptStep = string | ChatResult | Error | ((req: ChatRequest) => string | ChatResult);

export class FakeProvider implements ChatProvider {
  readonly protocol: ChatProvider['protocol'];
  readonly requests: ChatRequest[] = [];
  private readonly steps: ScriptStep[];

  constructor(steps: ScriptStep[], protocol: ChatProvider['protocol'] = 'openai') {
    this.steps = [...steps];
    this.protocol = protocol;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    this.requests.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
    const step = this.steps.shift();
    if (step === undefined) throw new Error(`FakeProvider: no scripted reply for request #${this.requests.length}`);
    if (step instanceof Error) throw step;
    const out = typeof step === 'function' ? step(req) : step;
    return typeof out === 'string' ? { text: out } : out;
  }

  get remaining(): number {
    return this.steps.length;
  }
}
