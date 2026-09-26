import { describe, expect, it } from 'vitest';
import type { LlmSettings } from '../types';
import { getTemperatureRange } from './index';
import { LLM_PRESETS } from './presets';
import { clampTemperature, isFixedTemperatureKimi, openAiTemperatureRange } from './temperature';

function llm(overrides: Partial<LlmSettings>): LlmSettings {
  return {
    presetId: 'custom-openai',
    protocol: 'openai',
    baseUrl: 'https://example.com/v1',
    apiKey: '',
    model: 'some-model',
    useProxy: true,
    jsonMode: true,
    effort: 'low',
    temperature: 0.8,
    ...overrides,
  };
}

describe('getTemperatureRange', () => {
  it('per provider: OpenAI range by default, 0–1 for Kimi / GLM, below 2 for DashScope', () => {
    expect(getTemperatureRange(llm({}))).toEqual({ min: 0, max: 2 });
    expect(getTemperatureRange(llm({ baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' }))).toEqual({ min: 0, max: 1 });
    expect(getTemperatureRange(llm({ baseUrl: 'https://api.moonshot.ai/v1', model: 'custom' }))).toEqual({ min: 0, max: 1 });
    expect(getTemperatureRange(llm({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.5-air' }))).toEqual({ min: 0, max: 1 });
    expect(getTemperatureRange(llm({ baseUrl: 'https://api.z.ai/api/paas/v4', model: 'glm-4.6' }))).toEqual({ min: 0, max: 1 });
    expect(getTemperatureRange(llm({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' }))).toEqual({ min: 0, max: 1.9 });
    // Look-alike hosts get no special treatment.
    expect(getTemperatureRange(llm({ baseUrl: 'https://notmoonshot.cn/v1' }))).toEqual({ min: 0, max: 2 });
  });

  it('null (hide the slider) for fixed-temperature models and protocols that send none', () => {
    for (const model of ['kimi-k3', 'kimi-k2.6', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'moonshotai/kimi-k2.6']) {
      expect(getTemperatureRange(llm({ baseUrl: 'https://api.moonshot.cn/v1', model })), model).toBeNull();
    }
    expect(getTemperatureRange(llm({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' }))).toBeNull();
    expect(getTemperatureRange(llm({ baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/o4-mini' }))).toBeNull();
    expect(getTemperatureRange(llm({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5' }))).toBeNull();
    expect(getTemperatureRange(llm({ protocol: 'demo' }))).toBeNull();
  });

  it('every OpenAI-compatible preset default has a defined answer', () => {
    for (const preset of LLM_PRESETS.filter((p) => p.protocol === 'openai' && p.baseUrl)) {
      const range = getTemperatureRange(llm({ baseUrl: preset.baseUrl, model: preset.defaultModel }));
      if (range) expect(range.max, preset.id).toBeGreaterThan(range.min);
    }
    // The Kimi preset's default model runs at a fixed temperature.
    const kimi = LLM_PRESETS.find((p) => p.id === 'moonshot')!;
    expect(getTemperatureRange(llm({ baseUrl: kimi.baseUrl, model: kimi.defaultModel }))).toBeNull();
  });
});

describe('temperature helpers', () => {
  it('isFixedTemperatureKimi covers K2.5+ and K3, not the older K2 / moonshot-v1 ids', () => {
    expect(isFixedTemperatureKimi('kimi-k2.5')).toBe(true);
    expect(isFixedTemperatureKimi('Kimi-K3')).toBe(true);
    expect(isFixedTemperatureKimi('kimi-k2-turbo-preview')).toBe(false);
    expect(isFixedTemperatureKimi('kimi-k2-0905-preview')).toBe(false);
    expect(isFixedTemperatureKimi('moonshot-v1-32k')).toBe(false);
  });

  it('clampTemperature', () => {
    expect(clampTemperature(1.4, { min: 0, max: 1 })).toBe(1);
    expect(clampTemperature(-1)).toBe(0);
    expect(clampTemperature(Number.POSITIVE_INFINITY)).toBe(0.8);
    expect(clampTemperature(Number.NaN, { min: 0, max: 0.5 })).toBe(0.5);
    expect(openAiTemperatureRange('not a url', 'x')).toEqual({ min: 0, max: 2 });
  });
});
