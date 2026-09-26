import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Lang, Settings } from '../types';

function detectLang(): Lang {
  if (typeof navigator === 'undefined') return 'zh';
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function createDefaultSettings(lang: Lang = detectLang()): Settings {
  return {
    version: 1,
    playerName: '',
    llm: {
      presetId: 'demo',
      protocol: 'demo',
      baseUrl: '',
      apiKey: '',
      model: '',
      useProxy: true,
      jsonMode: true,
      effort: 'low',
      temperature: 0.8,
    },
    tts: {
      engine: 'browser',
      browserVoice: { zh: '', en: '' },
      rate: 1,
      apiPresetId: 'openai',
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      apiModel: 'gpt-4o-mini-tts',
      apiVoice: '',
      useProxy: true,
    },
    stt: {
      engine: 'browser',
      apiPresetId: 'openai',
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      apiModel: 'whisper-1',
      useProxy: true,
      autoSubmit: false,
    },
    display: {
      uiLang: lang,
      textSpeed: 40,
      autoAdvance: false,
      autoDelayMs: 900,
      boxOpacity: 0.86,
      reduceMotion: false,
    },
    audio: { master: 0.8, bgm: 0.35, sfx: 0.6, voice: 1, muted: false },
  };
}

export const DEFAULT_SETTINGS: Settings = createDefaultSettings();

/** Recursive partial used by update(). Arrays / primitives are replaced wholesale. */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const cur = out[k];
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)
        ? deepMerge(cur, v as DeepPartial<typeof cur>)
        : v;
  }
  return out as T;
}

export interface SettingsState {
  settings: Settings;
  /** null = not checked yet. Set at startup from GET /api/health. Not persisted. */
  proxyAvailable: boolean | null;
  update: (patch: DeepPartial<Settings>) => void;
  replace: (settings: Settings) => void;
  resetSection: (section: Exclude<keyof Settings, 'version'>) => void;
  setProxyAvailable: (available: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      proxyAvailable: null,
      update: (patch) => set((s) => ({ settings: deepMerge(s.settings, patch) })),
      replace: (settings) => set({ settings }),
      resetSection: (section) =>
        set((s) => ({
          settings: { ...s.settings, [section]: createDefaultSettings(s.settings.display.uiLang)[section] },
        })),
      setProxyAvailable: (proxyAvailable) => set({ proxyAvailable }),
    }),
    {
      name: 'igg.settings.v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ settings: s.settings }),
      // Fill in fields added after the user's settings were saved.
      merge: (persisted, current) => {
        const saved = (persisted as { settings?: DeepPartial<Settings> } | undefined)?.settings;
        return { ...current, settings: deepMerge(current.settings, saved) };
      },
    },
  ),
);

/** Non-React accessor. */
export function getSettings(): Settings {
  return useSettingsStore.getState().settings;
}
