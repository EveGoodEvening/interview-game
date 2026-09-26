/**
 * Minimal i18n. Each namespace file exports `{ zh: {...}, en: {...} }` with flat keys;
 * keys are addressed as `${namespace}.${key}`, e.g. t('title.start').
 * Missing keys fall back to English, then to the key itself.
 * Interpolation: t('result.score', { n: 87 }) replaces `{n}`.
 */
import type { Lang, Localized } from '../types';
import { useSettingsStore } from '../store/settings';
import common from './common';
import title from './title';
import setup from './setup';
import settings from './settings';
import gallery from './gallery';
import interview from './interview';
import result from './result';

export type Dict = Record<string, string>;
export type Namespace = Localized<Dict>;

const NAMESPACES: Record<string, Namespace> = { common, title, setup, settings, gallery, interview, result };

const merged: Record<Lang, Dict> = { zh: {}, en: {} };
for (const [ns, dicts] of Object.entries(NAMESPACES)) {
  for (const lang of ['zh', 'en'] as const) {
    for (const [k, v] of Object.entries(dicts[lang])) merged[lang][`${ns}.${k}`] = v;
  }
}

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const raw = merged[lang][key] ?? merged.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

/** React hook: translator bound to the current UI language. */
export function useT(): TFunction {
  const lang = useSettingsStore((s) => s.settings.display.uiLang);
  return (key, vars) => translate(lang, key, vars);
}

/** React hook: current UI language. */
export function useUiLang(): Lang {
  return useSettingsStore((s) => s.settings.display.uiLang);
}

/** Pick the right language from a Localized value. */
export function loc<T>(value: Localized<T>, lang: Lang): T {
  return value[lang];
}

/** All keys per language — used by the parity test. */
export function allKeys(lang: Lang): string[] {
  return Object.keys(merged[lang]);
}
