/**
 * Interviewer AI public API.
 * OWNER: brain agent.
 */
import { createChatProvider } from '../llm';
import type { InterviewerAI, LlmSettings } from '../types';
import { createDemoInterviewer } from './demoInterviewer';
import { createLlmInterviewer } from './llmInterviewer';

export { createDemoInterviewer, getDemoDelay, setDemoDelay } from './demoInterviewer';
export type { DemoInterviewerOptions } from './demoInterviewer';
export { createLlmInterviewer, DEFAULT_MAX_TOKENS } from './llmInterviewer';
export type { LlmInterviewerOptions, LlmPurpose } from './llmInterviewer';
export { extractJson } from './json';
export {
  PlanSchema,
  TurnSchema,
  ReportSchema,
  normalizePlan,
  normalizeTurn,
  normalizeReport,
  cleanSpeech,
} from './schemas';

/**
 * The interviewer for the given LLM settings: the offline demo for protocol 'demo', otherwise an
 * LLM-backed interviewer. Throws LlmError('config') when the provider settings are incomplete
 * (from createChatProvider).
 */
export function createInterviewerAI(llm: LlmSettings): InterviewerAI {
  if (llm.protocol === 'demo') return createDemoInterviewer();
  return createLlmInterviewer(createChatProvider(llm));
}
