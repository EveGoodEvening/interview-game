/**
 * Provider presets shown in the Settings screen. Selecting a preset fills
 * protocol / baseUrl / model; the user can still edit every field.
 * OWNER: llm agent (may add presets / fields, must keep the exported shapes).
 */
import type { CharacterVoice, Localized, LlmProtocol, LlmSettings, SttSettings, TtsSettings } from '../types';

export interface LlmPreset {
  id: string;
  label: { zh: string; en: string };
  protocol: LlmProtocol;
  baseUrl: string;
  defaultModel: string;
  /** Suggestions for the model combobox. */
  models: string[];
  /** Where to get a key (shown as a hint). */
  keyUrl?: string;
  needsKey: boolean;
  /** Whether the provider is known to allow direct browser (CORS) calls. */
  corsOk: boolean;
  /** Optional one-line setup tip shown under the preset. */
  note?: Localized;
}

export interface SpeechApiPreset {
  id: string;
  label: { zh: string; en: string };
  baseUrl: string;
  defaultModel: string;
  models: string[];
  /** TTS only: available voices; STT presets leave this empty. */
  voices: string[];
  keyUrl?: string;
  /** Optional one-line setup tip shown under the preset. */
  note?: Localized;
}

export const LLM_PRESETS: LlmPreset[] = [
  {
    id: 'demo',
    label: { zh: '演示模式（离线，无需配置）', en: 'Demo (offline, no setup)' },
    protocol: 'demo',
    baseUrl: '',
    defaultModel: '',
    models: [],
    needsKey: false,
    corsOk: true,
    note: {
      zh: '内置的脚本面试官，完全离线运行。想要真正的 AI 面试官，请选择下方任一服务商。',
      en: 'A built-in scripted interviewer that runs fully offline. Pick a provider below for a real AI interviewer.',
    },
  },
  {
    id: 'anthropic',
    label: { zh: 'Anthropic Claude', en: 'Anthropic Claude' },
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-opus-5',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5-1'],
    keyUrl: 'https://platform.claude.com/settings/keys',
    needsKey: true,
    corsOk: true,
  },
  {
    id: 'openai',
    label: { zh: 'OpenAI', en: 'OpenAI' },
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5-mini',
    models: ['gpt-5-mini', 'gpt-5', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
    needsKey: true,
    corsOk: true,
  },
  {
    id: 'deepseek',
    label: { zh: 'DeepSeek 深度求索', en: 'DeepSeek' },
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    // deepseek-chat / deepseek-reasoner were retired on 2026-07-24 (api-docs.deepseek.com/updates).
    defaultModel: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    needsKey: true,
    corsOk: false,
  },
  {
    id: 'qwen',
    label: { zh: '通义千问 Qwen（阿里云百炼）', en: 'Qwen (Alibaba Cloud DashScope)' },
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
    keyUrl: 'https://bailian.console.aliyun.com/',
    needsKey: true,
    corsOk: false,
    note: {
      zh: '国际站用户请把地址改为 https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      en: 'International accounts: use https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    },
  },
  {
    id: 'moonshot',
    label: { zh: 'Kimi（月之暗面 Moonshot）', en: 'Kimi (Moonshot AI)' },
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    // The kimi-k2 preview/turbo ids (2026-05-25), kimi-latest and moonshot-v1 are retired (platform.kimi.ai/docs/models).
    // Current models run at a fixed temperature, so none is sent (temperature.ts).
    defaultModel: 'kimi-k2.6',
    models: ['kimi-k2.6', 'kimi-k3', 'kimi-k2.7-code'],
    keyUrl: 'https://platform.kimi.com/console/api-keys',
    needsKey: true,
    corsOk: false,
  },
  {
    id: 'zhipu',
    label: { zh: '智谱 GLM', en: 'Zhipu GLM' },
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.5-air',
    models: ['glm-4.5-air', 'glm-4.5', 'glm-4.6', 'glm-4-flash'],
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    needsKey: true,
    corsOk: false,
  },
  {
    id: 'siliconflow',
    label: { zh: '硅基流动 SiliconFlow', en: 'SiliconFlow' },
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    models: [
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen3-235B-A22B',
      'Qwen/Qwen2.5-72B-Instruct',
      'moonshotai/Kimi-K2-Instruct',
      'zai-org/GLM-4.5',
    ],
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    needsKey: true,
    corsOk: false,
  },
  {
    id: 'openrouter',
    label: { zh: 'OpenRouter', en: 'OpenRouter' },
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.5-flash',
    models: [
      'google/gemini-2.5-flash',
      'openai/gpt-5-mini',
      'anthropic/claude-sonnet-4.5',
      'deepseek/deepseek-chat',
      'qwen/qwen3-235b-a22b',
    ],
    keyUrl: 'https://openrouter.ai/keys',
    needsKey: true,
    corsOk: true,
  },
  {
    id: 'ollama',
    label: { zh: 'Ollama（本地模型）', en: 'Ollama (local models)' },
    protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:7b',
    models: ['qwen2.5:7b', 'qwen3:8b', 'llama3.1:8b', 'gemma3:12b'],
    keyUrl: 'https://ollama.com/download',
    needsKey: false,
    corsOk: true,
    note: {
      zh: '先运行 ollama pull <模型名>。不走中转直连时，若浏览器报跨域错误，请用 OLLAMA_ORIGINS=* 启动 ollama。',
      en: 'Run `ollama pull <model>` first. When calling directly (relay off) and the browser reports CORS errors, start Ollama with OLLAMA_ORIGINS=*.',
    },
  },
  {
    id: 'custom-openai',
    label: { zh: '自定义（OpenAI 兼容）', en: 'Custom (OpenAI-compatible)' },
    protocol: 'openai',
    baseUrl: '',
    defaultModel: '',
    models: [],
    needsKey: false,
    corsOk: false,
    note: {
      zh: '填写以 /v1 结尾的接口地址，例如 https://example.com/v1（会请求 {地址}/chat/completions）。',
      en: 'Enter the API root, usually ending in /v1 — requests go to {base}/chat/completions.',
    },
  },
  {
    id: 'custom-anthropic',
    label: { zh: '自定义（Anthropic 兼容）', en: 'Custom (Anthropic-compatible)' },
    protocol: 'anthropic',
    baseUrl: '',
    defaultModel: '',
    models: [],
    needsKey: true,
    corsOk: false,
    note: {
      zh: '填写不含 /v1 的接口地址，例如 https://example.com（会请求 {地址}/v1/messages）。',
      en: 'Enter the API root without /v1, e.g. https://example.com — requests go to {base}/v1/messages.',
    },
  },
];

const OPENAI_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];
const COSYVOICE_MODEL = 'FunAudioLLM/CosyVoice2-0.5B';
const COSYVOICE_VOICES = ['alex', 'benjamin', 'charles', 'david', 'anna', 'bella', 'claire', 'diana'].map(
  (v) => `${COSYVOICE_MODEL}:${v}`,
);

export const TTS_PRESETS: SpeechApiPreset[] = [
  {
    id: 'openai',
    label: { zh: 'OpenAI TTS', en: 'OpenAI TTS' },
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini-tts',
    models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
    voices: OPENAI_VOICES,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'siliconflow',
    label: { zh: '硅基流动 CosyVoice2', en: 'SiliconFlow CosyVoice2' },
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: COSYVOICE_MODEL,
    models: [COSYVOICE_MODEL],
    voices: COSYVOICE_VOICES,
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'custom',
    label: { zh: '自定义（OpenAI 兼容 /audio/speech）', en: 'Custom (OpenAI-compatible /audio/speech)' },
    baseUrl: '',
    defaultModel: '',
    models: [],
    voices: [],
  },
];

export const STT_PRESETS: SpeechApiPreset[] = [
  {
    id: 'openai',
    label: { zh: 'OpenAI Whisper', en: 'OpenAI Whisper' },
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'whisper-1',
    models: ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe'],
    voices: [],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'groq',
    label: { zh: 'Groq Whisper（极速）', en: 'Groq Whisper (fast)' },
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'whisper-large-v3-turbo',
    models: ['whisper-large-v3-turbo', 'whisper-large-v3'],
    voices: [],
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'siliconflow',
    label: { zh: '硅基流动 SenseVoice', en: 'SiliconFlow SenseVoice' },
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'FunAudioLLM/SenseVoiceSmall',
    models: ['FunAudioLLM/SenseVoiceSmall'],
    voices: [],
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'custom',
    label: { zh: '自定义（OpenAI 兼容 /audio/transcriptions）', en: 'Custom (OpenAI-compatible /audio/transcriptions)' },
    baseUrl: '',
    defaultModel: '',
    models: [],
    voices: [],
  },
];

/** Older / shorthand preset ids that map onto a current preset. */
const LLM_PRESET_ALIASES: Readonly<Record<string, string>> = { custom: 'custom-openai' };

export function findLlmPreset(id: string): LlmPreset | undefined {
  const key = LLM_PRESET_ALIASES[id] ?? id;
  return LLM_PRESETS.find((p) => p.id === key);
}

export function findTtsPreset(id: string): SpeechApiPreset | undefined {
  return TTS_PRESETS.find((p) => p.id === id);
}

export function findSttPreset(id: string): SpeechApiPreset | undefined {
  return STT_PRESETS.find((p) => p.id === id);
}

/** Lower-cased `host[:port]` of a URL, or '' when it isn't a valid absolute URL. */
function hostOf(url: string): string {
  try {
    return new URL(url.trim()).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * A key typed for one endpoint must never be sent to another provider, so it is kept
 * only when the new endpoint lives on the same host as the current one.
 */
function keyFor(currentBaseUrl: string, currentKey: string, nextBaseUrl: string): string {
  const host = hostOf(currentBaseUrl);
  return host !== '' && host === hostOf(nextBaseUrl) ? currentKey : '';
}

/**
 * Settings after the user picks an LLM preset in the Settings screen.
 * - `demo` only switches protocol, so the previous provider config comes back when the user switches again.
 * - `custom-*` keep the current URL / key / model for the user to edit.
 * - Named presets fill URL + default model; the API key is kept only for the same host.
 * Unknown ids return `current` unchanged.
 */
export function applyLlmPreset(current: LlmSettings, presetId: string): LlmSettings {
  const preset = findLlmPreset(presetId);
  if (!preset) return current;
  const base: LlmSettings = { ...current, presetId: preset.id, protocol: preset.protocol };
  if (preset.protocol === 'demo' || preset.baseUrl === '') return base;
  return {
    ...base,
    baseUrl: preset.baseUrl,
    apiKey: keyFor(current.baseUrl, current.apiKey, preset.baseUrl),
    model: preset.defaultModel,
  };
}

/** TTS settings after picking an API preset. `apiVoice` resets to '' (= the character's default voice). */
export function applyTtsPreset(current: TtsSettings, presetId: string): TtsSettings {
  const preset = findTtsPreset(presetId);
  if (!preset) return current;
  if (preset.baseUrl === '') return { ...current, apiPresetId: preset.id };
  return {
    ...current,
    apiPresetId: preset.id,
    apiBaseUrl: preset.baseUrl,
    apiKey: keyFor(current.apiBaseUrl, current.apiKey, preset.baseUrl),
    apiModel: preset.defaultModel,
    apiVoice: '',
  };
}

/** STT settings after picking an API preset. */
export function applySttPreset(current: SttSettings, presetId: string): SttSettings {
  const preset = findSttPreset(presetId);
  if (!preset) return current;
  if (preset.baseUrl === '') return { ...current, apiPresetId: preset.id };
  return {
    ...current,
    apiPresetId: preset.id,
    apiBaseUrl: preset.baseUrl,
    apiKey: keyFor(current.apiBaseUrl, current.apiKey, preset.baseUrl),
    apiModel: preset.defaultModel,
  };
}

/** The character's default API voice for a TTS preset (used when settings.tts.apiVoice is ''). */
export function presetVoiceFor(presetId: string, voice: CharacterVoice): string {
  return presetId === 'siliconflow' ? voice.siliconflowVoice : voice.openaiVoice;
}
