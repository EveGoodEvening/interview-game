/**
 * Shared domain types — the contract between modules.
 * Change with care: every module (llm, ai, store, speech, art, screens) depends on these.
 */

export type Lang = 'zh' | 'en';
export const LANGS: readonly Lang[] = ['zh', 'en'];

/** A string (or value) provided in every supported language. */
export interface Localized<T = string> {
  zh: T;
  en: T;
}

// ───────────────────────── Characters ─────────────────────────

export type CharacterId = 'yuki' | 'ethan' | 'haru';
export const CHARACTER_IDS: readonly CharacterId[] = ['yuki', 'ethan', 'haru'];

export type Expression = 'neutral' | 'smile' | 'happy' | 'thinking' | 'serious' | 'surprised' | 'troubled';
export const EXPRESSIONS: readonly Expression[] = ['neutral', 'smile', 'happy', 'thinking', 'serious', 'surprised', 'troubled'];

export type InterviewStyle = 'behavioral' | 'technical' | 'mixed';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface CharacterVoice {
  gender: 'female' | 'male';
  /** Browser speechSynthesis pitch (0–2, 1 = default). */
  pitch: number;
  /** Speed multiplier applied on top of the user's TTS rate. */
  rate: number;
  /** Default voice id for OpenAI-style /audio/speech endpoints (e.g. "nova"). */
  openaiVoice: string;
  /** Default voice id for SiliconFlow CosyVoice (e.g. "FunAudioLLM/CosyVoice2-0.5B:anna"). */
  siliconflowVoice: string;
}

export interface CharacterDef {
  id: CharacterId;
  name: Localized;
  /** Job title, e.g. "HR 经理" / "HR Manager". */
  title: Localized;
  /** Fictional company the interviewer represents. */
  company: Localized;
  /** One-line blurb for the character-select card. */
  tagline: Localized;
  /** 2–3 sentence profile for the select screen. */
  bio: Localized;
  /** Persona instructions for the LLM, written in the target language. */
  persona: Localized;
  defaultStyle: InterviewStyle;
  /** 1 (lenient) … 5 (harsh). Feeds scoring guidance in prompts. */
  strictness: number;
  /** Accent colour (hex) for name plate, UI highlights. */
  themeColor: string;
  voice: CharacterVoice;
}

// ───────────────────────── Settings ─────────────────────────

/** Wire protocol of an LLM provider. 'demo' = offline scripted interviewer, no network. */
export type LlmProtocol = 'anthropic' | 'openai' | 'demo';
export type Effort = 'low' | 'medium' | 'high';

export interface LlmSettings {
  /** Preset id from LLM_PRESETS (e.g. 'anthropic', 'deepseek', 'custom', 'demo'). */
  presetId: string;
  protocol: LlmProtocol;
  /** Base URL. anthropic: "https://api.anthropic.com"; openai-compatible: ".../v1". */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Route requests through the local relay (/api/proxy) to avoid CORS. */
  useProxy: boolean;
  /** Ask for structured JSON output (anthropic: output_config.format; openai: response_format json_object). */
  jsonMode: boolean;
  /** Only used by the anthropic protocol (output_config.effort). */
  effort: Effort;
  /** Only used by the openai protocol. */
  temperature: number;
}

export type TtsEngineKind = 'browser' | 'api' | 'off';
export interface TtsSettings {
  engine: TtsEngineKind;
  /** speechSynthesis voiceURI per interview language; '' = auto-pick by character gender. */
  browserVoice: Localized;
  /** User speed multiplier 0.5–2. */
  rate: number;
  /** OpenAI-compatible /audio/speech endpoint config. */
  apiPresetId: string;
  apiBaseUrl: string;
  apiKey: string;
  apiModel: string;
  /** '' = use the character's default voice for the preset. */
  apiVoice: string;
  useProxy: boolean;
}

export type SttEngineKind = 'browser' | 'api' | 'keyboard';
export interface SttSettings {
  engine: SttEngineKind;
  /** OpenAI-compatible /audio/transcriptions endpoint config. */
  apiPresetId: string;
  apiBaseUrl: string;
  apiKey: string;
  apiModel: string;
  useProxy: boolean;
  /** Submit automatically after recognition ends (otherwise the transcript is editable first). */
  autoSubmit: boolean;
}

export interface DisplaySettings {
  uiLang: Lang;
  /** Typewriter speed in characters per second; 0 = instant. */
  textSpeed: number;
  /** Auto-advance interviewer pages after voice ends. */
  autoAdvance: boolean;
  /** Extra delay before auto-advance (ms). */
  autoDelayMs: number;
  /** Dialogue box opacity 0.3–1. */
  boxOpacity: number;
  reduceMotion: boolean;
}

export interface AudioSettings {
  master: number; // 0–1
  bgm: number; // 0–1
  sfx: number; // 0–1
  voice: number; // 0–1
  muted: boolean;
}

export interface Settings {
  version: 1;
  playerName: string;
  llm: LlmSettings;
  tts: TtsSettings;
  stt: SttSettings;
  display: DisplaySettings;
  audio: AudioSettings;
}

// ───────────────────────── Interview ─────────────────────────

export interface InterviewConfig {
  characterId: CharacterId;
  /** Language the interview is conducted in (LLM output, TTS, STT). */
  lang: Lang;
  resumeText: string;
  resumeFileName: string;
  /** Target position; '' = infer from resume. */
  targetRole: string;
  /** Optional job description pasted by the player. */
  jobDescription: string;
  style: InterviewStyle;
  difficulty: Difficulty;
  /** Number of main topics/questions after the self-introduction (3–12). */
  mainQuestions: number;
  /** Max follow-up questions per main topic (0–3). */
  maxFollowUps: number;
  /** Seconds per answer; 0 = unlimited. */
  answerTimeLimitSec: number;
}

export interface PlanTopic {
  title: string;
  /** What the interviewer wants to learn with this topic. */
  goal: string;
}

export interface InterviewPlan {
  candidateName: string;
  targetRole: string;
  /** Interviewer's private 1–2 sentence impression of the resume. */
  summary: string;
  highlights: string[];
  concerns: string[];
  /** Exactly config.mainQuestions topics, in the order they will be asked. */
  topics: PlanTopic[];
  /** Greeting + request for a self-introduction. */
  opening: { speech: string; expression: Expression };
}

export type TurnKind = 'opening' | 'main' | 'followup' | 'reverse_prompt' | 'reverse_answer' | 'closing';

export interface AnswerAssessment {
  /** 0–10 score of the candidate's PREVIOUS answer. */
  score: number;
  /** Private note for the report; never spoken. */
  comment: string;
  /** Change in the interviewer's impression, -10 … +10. */
  affinityDelta: number;
}

export interface InterviewerTurn {
  kind: TurnKind;
  /** Short spoken reaction to the candidate's last utterance ('' if none). */
  reaction: string;
  /** The question / prompt to the candidate ('' for closing). Pinned on screen while answering. */
  question: string;
  expression: Expression;
  /** Plan topic this turn belongs to (null for opening / reverse / closing). */
  topicIndex: number | null;
  /** Assessment of the candidate's previous answer (null when there is nothing to assess). */
  assessment: AnswerAssessment | null;
}

/** What the engine asks the AI to produce next. The AI must obey it. */
export type TurnDirective =
  /** Ask the main question for plan topic `topicIndex` (after reacting to the last answer). */
  | { type: 'main'; topicIndex: number }
  /** Either follow up on `currentTopicIndex`, or move on to `next`. The AI chooses. */
  | { type: 'followup_or_next'; currentTopicIndex: number; next: { type: 'main'; topicIndex: number } | { type: 'reverse_prompt' } }
  /** Main questions are over: react, then invite the candidate's own questions. */
  | { type: 'reverse_prompt' }
  /** Answer the candidate's question in character, then ask whether they have more. */
  | { type: 'reverse_answer' }
  /** Wrap up and say goodbye. */
  | { type: 'closing' };

export type AnswerVia = 'voice' | 'text';

export interface TranscriptEntry {
  id: string;
  role: 'interviewer' | 'candidate';
  /** Full text as spoken. Interviewer: reaction + question. */
  text: string;
  /** Present on interviewer entries. */
  turn?: InterviewerTurn;
  /** Present on candidate entries. */
  answer?: { via: AnswerVia; durationSec: number; skipped: boolean };
  at: number;
}

export type SessionPhase = 'preparing' | 'intro' | 'questioning' | 'reverse' | 'closing' | 'evaluating' | 'finished';

export type DimensionKey = 'communication' | 'expertise' | 'logic' | 'impact' | 'fit';
export const DIMENSION_KEYS: readonly DimensionKey[] = ['communication', 'expertise', 'logic', 'impact', 'fit'];

export interface QuestionReview {
  question: string;
  answerSummary: string;
  score: number; // 0–10
  feedback: string;
  /** A concise model answer / improved version. */
  betterAnswer: string;
}

export interface InterviewReport {
  /** 0–100 */
  overallScore: number;
  /** One per DIMENSION_KEYS entry; score is 0–100 (engine normalizes). */
  dimensions: { key: DimensionKey; score: number; comment: string }[];
  strengths: string[];
  improvements: string[];
  questionReviews: QuestionReview[];
  /** Overall evaluation paragraph. */
  summary: string;
  /** Interviewer's in-character parting words for the ending screen. */
  finalMessage: string;
}

export type EndingId = 'perfect' | 'offer' | 'pending' | 'rejected';
export const ENDING_IDS: readonly EndingId[] = ['perfect', 'offer', 'pending', 'rejected'];

export interface InterviewSession {
  id: string;
  createdAt: number;
  config: InterviewConfig;
  plan: InterviewPlan | null;
  phase: SessionPhase;
  transcript: TranscriptEntry[];
  /** Index into plan.topics of the topic being discussed; -1 before the first main question. */
  currentTopicIndex: number;
  /** Main questions asked so far. */
  mainAsked: number;
  followUpsOnCurrent: number;
  /** Candidate questions answered during the reverse Q&A. */
  reverseAsked: number;
  /** Interviewer impression 0–100, starts at 50. */
  affinity: number;
  /** One per assessed candidate answer. */
  scores: { entryId: string; score: number; comment: string }[];
  report: InterviewReport | null;
  ending: EndingId | null;
  /** Blended final score 0–100 used for the ending. */
  finalScore: number | null;
}

/** A finished interview kept for the Records / Gallery screens. */
export interface InterviewRecord {
  id: string;
  finishedAt: number;
  characterId: CharacterId;
  lang: Lang;
  config: InterviewConfig;
  plan: InterviewPlan | null;
  transcript: TranscriptEntry[];
  report: InterviewReport;
  ending: EndingId;
  finalScore: number;
  affinity: number;
}

// ───────────────────────── AI interface ─────────────────────────

export interface TurnContext {
  config: InterviewConfig;
  character: CharacterDef;
  plan: InterviewPlan;
  /** Whole transcript so far; the last entry is the candidate's latest utterance. */
  transcript: TranscriptEntry[];
  directive: TurnDirective;
  progress: {
    mainAsked: number;
    mainTotal: number;
    followUpsOnCurrent: number;
    maxFollowUps: number;
    reverseAsked: number;
  };
}

export interface EvaluationContext {
  config: InterviewConfig;
  character: CharacterDef;
  plan: InterviewPlan;
  transcript: TranscriptEntry[];
  scores: InterviewSession['scores'];
  affinity: number;
}

/** The interviewer brain. Implemented by the LLM-backed interviewer and the offline demo. */
export interface InterviewerAI {
  readonly isDemo: boolean;
  prepare(config: InterviewConfig, character: CharacterDef, signal?: AbortSignal): Promise<InterviewPlan>;
  nextTurn(ctx: TurnContext, signal?: AbortSignal): Promise<InterviewerTurn>;
  evaluate(ctx: EvaluationContext, signal?: AbortSignal): Promise<InterviewReport>;
}

// ───────────────────────── Navigation / stage ─────────────────────────

export type ScreenId = 'title' | 'setup' | 'interview' | 'result' | 'settings' | 'gallery' | 'records' | 'artPreview';

/** What the interview screen should be doing right now. */
export type Stage =
  | { kind: 'idle' }
  | { kind: 'loading'; reason: 'preparing' | 'thinking' | 'evaluating' }
  /** Present interviewer entry `entryId` (typewriter + voice). UI calls interviewerDone() when finished. */
  | { kind: 'interviewer'; entryId: string }
  /** Waiting for the candidate's answer to the last interviewer entry. */
  | { kind: 'answer' }
  | { kind: 'error'; message: string; code: string; retry: 'prepare' | 'turn' | 'evaluate' }
  /** Session finished; result screen shows the report. */
  | { kind: 'ended' };
