/**
 * LLM-backed interviewer on top of any ChatProvider (anthropic / openai-compatible).
 * Structured output is requested via `jsonSchema`, but every reply is still extracted and
 * normalized leniently; one corrective retry on unusable output, then LlmError('parse').
 */
import type { ChatMessage, ChatProvider, ChatRequest, ChatResult } from '../llm/types';
import { LlmError } from '../llm/types';
import type { InterviewReport, InterviewerAI, InterviewerTurn, Lang, TurnContext } from '../types';
import { allowedKinds } from '../engine/directive';
import { pairQuestionsAndAnswers } from '../engine/qa';
import { alignOverallScore, projectedEnding, referenceOverall } from '../engine/scoring';
import { truncate } from '../engine/text';
import { ASSESSABLE_KINDS, pendingReply } from '../engine/transcript';
import { heuristicAssessment } from './demo/analysis';
import { demoFinalMessage } from './demo/report';
import { extractJson } from './json';
import {
  PLAN_TEMPLATE,
  REPORT_TEMPLATE,
  TURN_TEMPLATE,
  buildEvaluationRequest,
  buildPlanRequest,
  buildTurnRequest,
  correctionNudge,
} from './prompts';
import { PlanSchema, ReportSchema, TurnSchema, defaultAffinityDelta, normalizePlan, normalizeReport, normalizeTurn } from './schemas';

export type LlmPurpose = 'plan' | 'turn' | 'report';

/**
 * Output budgets per protocol. Claude Opus 5 thinks adaptively by default and `max_tokens` caps
 * thinking + answer, so Claude gets generous budgets (billing follows actual output, not the cap).
 * Many OpenAI-compatible servers cap max_tokens at 8192 (self-hosted vLLM, older models), so they stay
 * at or below it; a server with a lower cap is handled by the openai provider (it retries within the
 * limit named by the 400).
 */
export const DEFAULT_MAX_TOKENS: Readonly<Record<ChatProvider['protocol'], Readonly<Record<LlmPurpose, number>>>> = {
  anthropic: { plan: 8000, turn: 4000, report: 12000 },
  openai: { plan: 4000, turn: 2000, report: 6000 },
};
/**
 * Largest output budget per protocol: the report's scaled budget and the retry after a 'truncated'
 * error both stay at or below it (doubling an OpenAI-compatible budget past 8192 turns a truncated
 * reply into a 400 on servers capped there).
 */
export const MAX_TOKENS_CEILING: Readonly<Record<ChatProvider['protocol'], number>> = { anthropic: 16000, openai: 8192 };
/** Default request timeout (ms) of the providers; long reports get more. */
const BASE_TIMEOUT_MS = 120_000;

/** Report budget: ~300–400 output tokens per reviewed question on top of the fixed parts. */
export function reportMaxTokens(protocol: ChatProvider['protocol'], questions: number): number {
  const perQuestion = protocol === 'anthropic' ? 400 : 250;
  return Math.min(MAX_TOKENS_CEILING[protocol], Math.max(DEFAULT_MAX_TOKENS[protocol].report, 3000 + perQuestion * questions));
}

/** Highest score a heuristic stand-in may give: it sees length and specifics, not quality. */
const HEURISTIC_MAX_SCORE = 6;

export interface LlmInterviewerOptions {
  maxTokens?: Partial<Record<LlmPurpose, number>>;
  /** Per-request timeout (ms); provider default when omitted. */
  timeoutMs?: Partial<Record<LlmPurpose, number>>;
  /** Observe raw results (debugging / telemetry). */
  onResult?: (purpose: LlmPurpose, result: ChatResult) => void;
}

const TRUNCATED_STOP_REASONS = new Set(['max_tokens', 'length', 'model_length']);

interface JsonCall<T> {
  purpose: LlmPurpose;
  lang: Lang;
  system: string;
  messages: ChatMessage[];
  schema: ChatRequest['jsonSchema'];
  normalize: (raw: unknown) => T | null;
  /** JSON shape restated in the correction nudge. */
  template: string;
  /** Semantic check of a usable value; a returned reason triggers the (single) corrective retry. */
  check?: (value: T) => string | null;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LlmError('aborted', 'Request aborted');
}

export function createLlmInterviewer(provider: ChatProvider, opts: LlmInterviewerOptions = {}): InterviewerAI {
  const maxTokensFor = (p: LlmPurpose) => opts.maxTokens?.[p] ?? DEFAULT_MAX_TOKENS[provider.protocol][p];
  const ceiling = MAX_TOKENS_CEILING[provider.protocol];

  /**
   * Call the provider and normalize the JSON reply.
   * - LlmError('truncated') or a max-tokens stop → one retry with double the token budget (at most the
   *   protocol's MAX_TOKENS_CEILING).
   * - Unusable output, or output failing `check` → one retry that shows the model its bad output plus a
   *   correction nudge restating the format. A value that still fails `check` is returned anyway (the
   *   engine coerces it); still unusable → LlmError('parse') with the raw text in `detail`.
   */
  async function chatJson<T>(call: JsonCall<T>): Promise<T> {
    let messages = call.messages;
    let maxTokens = call.maxTokens ?? maxTokensFor(call.purpose);
    let grewTokens = false;
    let corrected = false;
    /** A usable value that failed `check`: kept in case the corrective retry comes back unusable. */
    let unchecked: T | null = null;
    for (;;) {
      throwIfAborted(call.signal);
      let result: ChatResult;
      try {
        result = await provider.chat({
          system: call.system,
          messages,
          maxTokens,
          jsonSchema: call.schema,
          purpose: call.purpose,
          signal: call.signal,
          timeoutMs: opts.timeoutMs?.[call.purpose] ?? call.timeoutMs,
        });
      } catch (err) {
        if (err instanceof LlmError && err.code === 'truncated' && !grewTokens && maxTokens < ceiling) {
          grewTokens = true;
          maxTokens = Math.min(ceiling, maxTokens * 2);
          continue;
        }
        throw err;
      }
      throwIfAborted(call.signal);
      opts.onResult?.(call.purpose, result);

      // A reply cut off by the token limit is retried with a bigger budget before we try to salvage it.
      if (result.stopReason && TRUNCATED_STOP_REASONS.has(result.stopReason) && !grewTokens && maxTokens < ceiling) {
        grewTokens = true;
        maxTokens = Math.min(ceiling, maxTokens * 2);
        continue;
      }
      const fromParsed = result.parsed !== undefined ? call.normalize(result.parsed) : null;
      const value = fromParsed ?? call.normalize(extractJson(result.text));
      const problem = value !== null && !corrected ? (call.check?.(value) ?? null) : null;
      if (value !== null && problem === null) return value;

      if (corrected) {
        if (unchecked !== null) return unchecked;
        throw new LlmError('parse', `The model returned an unusable ${call.purpose} response`, { detail: truncate(result.text, 2000) });
      }
      corrected = true;
      unchecked = value;
      const zh = call.lang === 'zh';
      const found = extractJson(result.text) !== undefined || result.parsed !== undefined;
      const reason =
        problem ??
        (found
          ? zh
            ? '缺少必需字段，或者 JSON 格式有误（字符串里的双引号要写成 \\"）'
            : 'required fields are missing or the JSON is malformed (escape double quotes inside strings as \\")'
          : zh
            ? '没有找到 JSON 对象'
            : 'no JSON object was found');
      messages = [
        ...call.messages,
        { role: 'assistant', content: truncate(result.text.trim(), 4000) || '(empty)' },
        { role: 'user', content: correctionNudge(call.lang, reason, call.template) },
      ];
    }
  }

  /**
   * LLMs occasionally drop the assessment; score the reply heuristically instead of losing it. The
   * heuristic only sees length and specifics, so its stand-in score is capped at "adequate".
   */
  function ensureAssessment(turn: InterviewerTurn, ctx: TurnContext): InterviewerTurn {
    if (turn.assessment) return turn;
    const reply = pendingReply(ctx.transcript);
    if (!reply || reply.entry.answer?.skipped) return turn;
    const answered = reply.answered?.kind ?? 'opening';
    if (!ASSESSABLE_KINDS.includes(answered)) return turn;
    const h = heuristicAssessment(reply.entry.text, ctx.config.lang, ctx.character, ctx.config.difficulty);
    const score = Math.min(h.score, HEURISTIC_MAX_SCORE);
    return { ...turn, assessment: { ...h, score, affinityDelta: Math.min(h.affinityDelta, defaultAffinityDelta(HEURISTIC_MAX_SCORE)) } };
  }

  /** A kind the directive doesn't allow is worth one corrective retry before the engine coerces it. */
  function checkKind(turn: InterviewerTurn, ctx: TurnContext): string | null {
    const allowed = allowedKinds(ctx.directive);
    if (allowed.includes(turn.kind)) return null;
    // 'opening' is the normalizer's "unknown or missing kind"; with a single allowed kind it is unambiguous.
    if (turn.kind === 'opening' && allowed.length === 1) return null;
    const list = allowed.map((k) => `"${k}"`).join(ctx.config.lang === 'zh' ? ' 或 ' : ' or ');
    if (turn.kind === 'opening') return ctx.config.lang === 'zh' ? `kind 缺失或无效，这一轮只能用 ${list}` : `kind is missing or invalid; this turn allows only ${list}`;
    return ctx.config.lang === 'zh' ? `kind "${turn.kind}" 在这一轮不允许，只能用 ${list}` : `kind "${turn.kind}" is not allowed this turn; use ${list}`;
  }

  return {
    isDemo: false,

    async prepare(config, character, signal) {
      const req = buildPlanRequest(config, character);
      return chatJson({
        purpose: 'plan',
        lang: config.lang,
        ...req,
        schema: PlanSchema,
        template: PLAN_TEMPLATE,
        normalize: (raw) => normalizePlan(raw, config, character),
        signal,
      });
    },

    async nextTurn(ctx, signal) {
      const req = buildTurnRequest(ctx);
      const turn = await chatJson({
        purpose: 'turn',
        lang: ctx.config.lang,
        ...req,
        schema: TurnSchema,
        template: TURN_TEMPLATE,
        normalize: (raw) => normalizeTurn(raw, ctx.config.lang),
        check: (turn) => checkKind(turn, ctx),
        signal,
      });
      return ensureAssessment(turn, ctx);
    },

    async evaluate(ctx, signal): Promise<InterviewReport> {
      const qa = pairQuestionsAndAnswers(ctx.transcript, ctx.scores);
      const reference = referenceOverall(ctx.scores, ctx.transcript);
      const projected = projectedEnding(ctx.scores, ctx.affinity, ctx.transcript);
      const req = buildEvaluationRequest(ctx, { qa, reference, projected });
      const report = await chatJson({
        purpose: 'report',
        lang: ctx.config.lang,
        ...req,
        schema: ReportSchema,
        template: REPORT_TEMPLATE,
        maxTokens: opts.maxTokens?.report ?? reportMaxTokens(provider.protocol, qa.length),
        timeoutMs: Math.min(300_000, Math.max(BASE_TIMEOUT_MS, 60_000 + 5_000 * qa.length)),
        normalize: (raw) =>
          normalizeReport(raw, {
            lang: ctx.config.lang,
            qa,
            reference,
            fallbackFinalMessage: demoFinalMessage(ctx.character.id, projected, ctx.config.lang),
          }),
        signal,
      });
      // Keep the score near the in-interview evidence and consistent with the parting words,
      // which were written for the projected ending.
      return {
        ...report,
        overallScore: alignOverallScore(report.overallScore, { reference, affinity: ctx.affinity, ending: qa.length ? projected : null }),
      };
    },
  };
}
