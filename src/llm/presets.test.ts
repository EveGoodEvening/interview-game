import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../characters';
import { createDefaultSettings } from '../store/settings';
import { CHARACTER_IDS, type LlmSettings } from '../types';
import {
  applyLlmPreset,
  applySttPreset,
  applyTtsPreset,
  findLlmPreset,
  findSttPreset,
  findTtsPreset,
  LLM_PRESETS,
  presetVoiceFor,
  STT_PRESETS,
  TTS_PRESETS,
  type SpeechApiPreset,
} from './presets';

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.host !== '';
  } catch {
    return false;
  }
}

function expectUniqueIds(list: { id: string }[]) {
  const ids = list.map((p) => p.id);
  expect(new Set(ids).size).toBe(ids.length);
}

describe('LLM_PRESETS', () => {
  it('has unique ids and every required provider', () => {
    expectUniqueIds(LLM_PRESETS);
    for (const id of [
      'demo',
      'anthropic',
      'openai',
      'deepseek',
      'qwen',
      'moonshot',
      'zhipu',
      'siliconflow',
      'openrouter',
      'ollama',
      'custom-openai',
      'custom-anthropic',
    ]) {
      expect(findLlmPreset(id), id).toBeDefined();
    }
  });

  it('starts with the offline demo', () => {
    expect(LLM_PRESETS[0]).toMatchObject({ id: 'demo', protocol: 'demo', needsKey: false, baseUrl: '' });
  });

  it.each(LLM_PRESETS.map((p) => [p.id, p] as const))('%s is internally consistent', (_id, p) => {
    expect(p.label.zh.trim()).not.toBe('');
    expect(p.label.en.trim()).not.toBe('');
    if (p.keyUrl) expect(isHttpUrl(p.keyUrl)).toBe(true);
    if (p.note) {
      expect(p.note.zh.trim()).not.toBe('');
      expect(p.note.en.trim()).not.toBe('');
    }
    if (p.protocol === 'demo' || p.id.startsWith('custom')) {
      expect(p.baseUrl).toBe('');
      expect(p.defaultModel).toBe('');
      return;
    }
    expect(isHttpUrl(p.baseUrl)).toBe(true);
    expect(p.baseUrl.endsWith('/')).toBe(false);
    expect(p.models.length).toBeGreaterThan(0);
    expect(p.models).toContain(p.defaultModel);
    expect(new Set(p.models).size).toBe(p.models.length);
    // Anthropic base URLs must not include /v1 (the SDK adds it); OpenAI-compatible ones include the API root.
    if (p.protocol === 'anthropic') expect(p.baseUrl).not.toMatch(/\/v1$/);
  });

  it('matches the spec for the key providers', () => {
    expect(findLlmPreset('anthropic')).toMatchObject({
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      defaultModel: 'claude-opus-5',
      needsKey: true,
    });
    expect(findLlmPreset('anthropic')?.models).toEqual(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5-1']);
    expect(findLlmPreset('deepseek')).toMatchObject({ defaultModel: 'deepseek-flash', models: ['deepseek-flash', 'deepseek-v4-pro'] });
    expect(findLlmPreset('moonshot')).toMatchObject({
      baseUrl: 'https://api.moonshot.cn/v1',
      defaultModel: 'kimi-k2.6',
      models: ['kimi-k2.6', 'kimi-k3', 'kimi-k2.7-code'],
    });
    expect(findLlmPreset('qwen')?.models).toEqual(['qwen-plus', 'qwen-max', 'qwen-turbo']);
    expect(findLlmPreset('zhipu')?.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
    expect(findLlmPreset('ollama')).toMatchObject({ baseUrl: 'http://localhost:11434/v1', needsKey: false, protocol: 'openai' });
    expect(findLlmPreset('custom-anthropic')?.protocol).toBe('anthropic');
    expect(findLlmPreset('custom-openai')?.protocol).toBe('openai');
  });

  it('does not offer model ids the providers have retired', () => {
    const retired = ['deepseek-chat', 'deepseek-reasoner', 'kimi-k2-turbo-preview', 'kimi-k2-0905-preview', 'kimi-latest', 'moonshot-v1-32k'];
    for (const id of ['deepseek', 'moonshot']) {
      const preset = findLlmPreset(id)!;
      for (const model of [preset.defaultModel, ...preset.models]) expect(retired, `${id}: ${model}`).not.toContain(model);
    }
  });

  it('only keyless presets skip the key', () => {
    const keyless = LLM_PRESETS.filter((p) => !p.needsKey).map((p) => p.id);
    expect(keyless.sort()).toEqual(['custom-openai', 'demo', 'ollama']);
  });

  it('resolves the legacy "custom" id', () => {
    expect(findLlmPreset('custom')?.id).toBe('custom-openai');
    expect(findLlmPreset('nope')).toBeUndefined();
  });
});

describe.each([
  ['TTS_PRESETS', TTS_PRESETS],
  ['STT_PRESETS', STT_PRESETS],
] as const)('%s', (_name, list: SpeechApiPreset[]) => {
  it('has unique ids, a custom entry and valid named presets', () => {
    expectUniqueIds(list);
    expect(list.some((p) => p.id === 'custom' && p.baseUrl === '')).toBe(true);
    for (const p of list) {
      expect(p.label.zh.trim()).not.toBe('');
      expect(p.label.en.trim()).not.toBe('');
      if (p.keyUrl) expect(isHttpUrl(p.keyUrl)).toBe(true);
      if (p.id === 'custom') continue;
      expect(isHttpUrl(p.baseUrl)).toBe(true);
      expect(p.models).toContain(p.defaultModel);
    }
  });
});

describe('speech presets', () => {
  it('lists the specified models and voices', () => {
    expect(findTtsPreset('openai')).toMatchObject({ baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini-tts' });
    expect(findTtsPreset('openai')?.models).toContain('tts-1');
    expect(findTtsPreset('openai')?.voices).toEqual(['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer']);
    expect(findTtsPreset('siliconflow')?.defaultModel).toBe('FunAudioLLM/CosyVoice2-0.5B');
    expect(findTtsPreset('siliconflow')?.voices).toHaveLength(8);
    expect(findTtsPreset('siliconflow')?.voices.every((v) => v.startsWith('FunAudioLLM/CosyVoice2-0.5B:'))).toBe(true);
    expect(findSttPreset('openai')?.models).toEqual(expect.arrayContaining(['whisper-1', 'gpt-4o-mini-transcribe']));
    expect(findSttPreset('groq')).toMatchObject({ baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'whisper-large-v3-turbo' });
    expect(findSttPreset('siliconflow')?.defaultModel).toBe('FunAudioLLM/SenseVoiceSmall');
    for (const p of STT_PRESETS) expect(p.voices).toEqual([]);
  });

  it("covers every character's default voices", () => {
    for (const id of CHARACTER_IDS) {
      const { voice } = CHARACTERS[id];
      expect(findTtsPreset('openai')?.voices).toContain(voice.openaiVoice);
      expect(findTtsPreset('siliconflow')?.voices).toContain(voice.siliconflowVoice);
      expect(presetVoiceFor('openai', voice)).toBe(voice.openaiVoice);
      expect(presetVoiceFor('custom', voice)).toBe(voice.openaiVoice);
      expect(presetVoiceFor('siliconflow', voice)).toBe(voice.siliconflowVoice);
    }
  });

  it('settings defaults point at existing presets', () => {
    const s = createDefaultSettings('en');
    expect(findLlmPreset(s.llm.presetId)).toBeDefined();
    expect(findTtsPreset(s.tts.apiPresetId)?.baseUrl).toBe(s.tts.apiBaseUrl);
    expect(findSttPreset(s.stt.apiPresetId)?.baseUrl).toBe(s.stt.apiBaseUrl);
  });
});

describe('applyLlmPreset', () => {
  const current: LlmSettings = {
    presetId: 'openai',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-openai',
    model: 'gpt-4.1',
    useProxy: false,
    jsonMode: false,
    effort: 'medium',
    temperature: 0.3,
  };

  it('fills URL and model, and never carries a key to another host', () => {
    const next = applyLlmPreset(current, 'deepseek');
    expect(next).toEqual({
      ...current,
      presetId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-flash',
      apiKey: '',
    });
  });

  it('keeps the key on the same host and the user preferences', () => {
    const next = applyLlmPreset({ ...current, presetId: 'custom-openai', model: 'x' }, 'openai');
    expect(next).toMatchObject({ presetId: 'openai', apiKey: 'sk-openai', model: 'gpt-5-mini', useProxy: false, jsonMode: false, temperature: 0.3 });
  });

  it('switches to demo without discarding the provider config', () => {
    const demo = applyLlmPreset(current, 'demo');
    expect(demo).toEqual({ ...current, presetId: 'demo', protocol: 'demo' });
    expect(applyLlmPreset(demo, 'openai')).toMatchObject({ protocol: 'openai', apiKey: 'sk-openai' });
  });

  it('custom presets keep the fields for editing; unknown ids are ignored', () => {
    expect(applyLlmPreset(current, 'custom-anthropic')).toEqual({ ...current, presetId: 'custom-anthropic', protocol: 'anthropic' });
    expect(applyLlmPreset(current, 'nope')).toBe(current);
  });
});

describe('applyTtsPreset / applySttPreset', () => {
  const s = createDefaultSettings('en');

  it('fills the endpoint and resets the voice to the character default', () => {
    const tts = applyTtsPreset({ ...s.tts, apiKey: 'sk-openai', apiVoice: 'onyx' }, 'siliconflow');
    expect(tts).toMatchObject({
      apiPresetId: 'siliconflow',
      apiBaseUrl: 'https://api.siliconflow.cn/v1',
      apiModel: 'FunAudioLLM/CosyVoice2-0.5B',
      apiVoice: '',
      apiKey: '',
    });
    expect(applyTtsPreset(tts, 'custom')).toEqual({ ...tts, apiPresetId: 'custom' });
    expect(applyTtsPreset(tts, 'nope')).toBe(tts);
  });

  it('keeps the key when the host is unchanged', () => {
    const stt = applySttPreset({ ...s.stt, apiKey: 'sk-openai', apiModel: 'gpt-4o-mini-transcribe' }, 'openai');
    expect(stt).toMatchObject({ apiPresetId: 'openai', apiKey: 'sk-openai', apiModel: 'whisper-1' });
    expect(applySttPreset(stt, 'groq')).toMatchObject({ apiKey: '', apiBaseUrl: 'https://api.groq.com/openai/v1' });
  });
});
