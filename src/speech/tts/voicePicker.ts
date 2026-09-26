/**
 * Choosing a speechSynthesis voice for an interviewer.
 *
 * 1. An explicit `preferredURI` (settings.tts.browserVoice[lang]) wins when that voice exists.
 * 2. Otherwise voices are scored:
 *    - language (required): zh — zh-CN 100 > zh-Hans/zh-SG 90 > zh-TW 80 > cmn-* 70 >
 *      zh-HK / yue 30 (Cantonese would read Mandarin text in Cantonese);
 *      en — en-US 100 > en-GB 85 > other en-* 75 > bare "en" 70.
 *    - gender (+30 match / −30 opposite) by name heuristics, see FEMALE_VOICE_HINTS / MALE_VOICE_HINTS.
 *    - quality (+20, +5 more for "natural"): names containing natural / neural / online /
 *      premium / enhanced / wavenet / studio (Edge "Online (Natural)", Apple "Premium", …).
 *    - Google network voices +8 (good quality in Chrome); the platform default +3.
 *    - novelty / robotic voices −60 (macOS joke voices, eSpeak).
 *    Ties keep the browser's order.
 */
import type { Lang } from '../../types';

/** The subset of SpeechSynthesisVoice we use (makes testing easy). */
export interface VoiceLike {
  readonly voiceURI: string;
  readonly name: string;
  readonly lang: string;
  readonly localService: boolean;
  readonly default: boolean;
}

export type VoiceGender = 'female' | 'male';

/**
 * Name hints per gender. Single words are matched as whole words of the voice name
 * ("Microsoft Liam Online - English (Canada)" must not match "ana"); hints containing a space
 * or CJK characters are matched as substrings.
 */
export const FEMALE_VOICE_HINTS: Readonly<Record<Lang, readonly string[]>> = {
  zh: [
    // Microsoft (Edge / Windows)
    'xiaoxiao', 'xiaoyi', 'xiaohan', 'xiaomeng', 'xiaomo', 'xiaoqiu', 'xiaorui', 'xiaoshuang', 'xiaoxuan',
    'xiaoyan', 'xiaoyou', 'xiaozhen', 'xiaochen', 'xiaobei', 'xiaoni', 'huihui', 'yaoyao', 'hanhan', 'hsiaochen', 'hsiaoyu', 'hiugaai', 'hiumaan',
    // Apple
    'tingting', 'ting-ting', 'meijia', 'mei-jia', 'sinji', 'sin-ji', 'yu-shu', 'yushu', 'lili', 'lanlan', 'shanshan',
    // Google (Chrome's zh voices are female)
    'google 普通话', 'google 國語', 'google 粤語', 'google 粵語',
    '女',
  ],
  en: [
    'aria', 'jenny', 'michelle', 'ana', 'emma', 'ava', 'sara', 'sonia', 'libby', 'natasha', 'clara', 'jane', 'nancy',
    'amber', 'ashley', 'cora', 'elizabeth', 'monica', 'samantha', 'victoria', 'karen', 'moira', 'tessa', 'fiona',
    'veena', 'serena', 'allison', 'susan', 'zira', 'hazel', 'heera', 'catherine', 'kate', 'nicky', 'joelle',
    'noelle', 'zoe', 'emily', 'olivia', 'molly', 'maisie', 'jessa', 'aoife', 'neerja', 'leah', 'luna',
    'google us english', 'google uk english female',
  ],
};

export const MALE_VOICE_HINTS: Readonly<Record<Lang, readonly string[]>> = {
  zh: [
    'yunxi', 'yunjian', 'yunyang', 'yunfeng', 'yunhao', 'yunye', 'yunze', 'yunxia', 'yunjhe', 'wanlung', 'kangkang', 'zhiwei',
    'li-mu', 'limu', 'binbin',
    '男',
  ],
  en: [
    'guy', 'davis', 'daniel', 'alex', 'tony', 'jason', 'eric', 'christopher', 'roger', 'steffan', 'brian', 'andrew',
    'ryan', 'thomas', 'william', 'liam', 'mitchell', 'prabhat', 'fred', 'tom', 'aaron', 'arthur', 'oliver', 'gordon',
    'lee', 'rishi', 'mark', 'david', 'george', 'james', 'evan', 'nathan', 'connor', 'duncan', 'ken',
    'google uk english male',
  ],
};

/** Generic markers that some platforms put in names ("… Female", "… (Male)"). */
const GENERIC_FEMALE = ['female', 'woman'];
const GENERIC_MALE = ['male', 'man'];

const QUALITY_HINTS = ['natural', 'neural', 'online', 'premium', 'enhanced', 'wavenet', 'studio'];

/** macOS novelty voices and eSpeak-style robots that make a poor interviewer. */
const NOVELTY_HINTS = [
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'good news', 'jester', 'organ', 'superstar',
  'trinoids', 'whisper', 'wobble', 'zarvox', 'deranged', 'hysterical', 'espeak', 'robot',
];

function normalizeTag(lang: string): string {
  return lang.trim().replace(/_/g, '-').toLowerCase();
}

/** Language fit 0–100; 0 = unusable for this interview language. */
export function langScore(voiceLang: string, lang: Lang): number {
  const tag = normalizeTag(voiceLang);
  if (!tag) return 0;
  if (lang === 'zh') {
    if (tag === 'zh-cn' || tag === 'zh-hans-cn') return 100;
    if (tag === 'zh-hans' || tag === 'zh-sg' || tag === 'zh') return 90;
    if (tag === 'zh-hk' || tag.startsWith('yue') || tag === 'zh-yue') return 30;
    if (tag.startsWith('zh-')) return 80;
    if (tag.startsWith('cmn')) return 70;
    return 0;
  }
  if (tag === 'en-us') return 100;
  if (tag === 'en-gb') return 85;
  if (tag.startsWith('en-')) return 75;
  if (tag === 'en') return 70;
  return 0;
}

function nameWords(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9\-\u00C0-\u024F]+/)
      .flatMap((w) => [w, ...w.split('-')])
      .filter(Boolean),
  );
}

function matchesAny(name: string, words: Set<string>, hints: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return hints.some((hint) => (/[\s\u2E80-\u9FFF]/.test(hint) || hint.includes('-') ? lower.includes(hint) : words.has(hint)));
}

/** Guess a voice's gender from its name; null when unknown. */
export function guessVoiceGender(voice: Pick<VoiceLike, 'name'>, lang: Lang): VoiceGender | null {
  const words = nameWords(voice.name);
  const female = matchesAny(voice.name, words, FEMALE_VOICE_HINTS[lang]) || matchesAny(voice.name, words, GENERIC_FEMALE);
  const male = matchesAny(voice.name, words, MALE_VOICE_HINTS[lang]) || matchesAny(voice.name, words, GENERIC_MALE);
  if (female && !male) return 'female';
  if (male && !female) return 'male';
  return null;
}

/** Score a voice for (lang, gender); -Infinity when the language does not match. */
export function scoreVoice(voice: VoiceLike, lang: Lang, gender: VoiceGender): number {
  const ls = langScore(voice.lang, lang);
  if (ls === 0) return Number.NEGATIVE_INFINITY;
  const lower = voice.name.toLowerCase();
  let score = ls;
  const g = guessVoiceGender(voice, lang);
  if (g === gender) score += 30;
  else if (g !== null) score -= 30;
  if (QUALITY_HINTS.some((q) => lower.includes(q))) score += 20;
  if (lower.includes('natural')) score += 5;
  if (lower.startsWith('google')) score += 8;
  if (voice.default) score += 3;
  if (NOVELTY_HINTS.some((n) => lower.includes(n))) score -= 60;
  return score;
}

/** Voices usable for `lang`, best first. */
export function rankVoices<V extends VoiceLike>(voices: readonly V[], lang: Lang, gender: VoiceGender): V[] {
  return voices
    .map((voice, index) => ({ voice, index, score: scoreVoice(voice, lang, gender) }))
    .filter((v) => v.score > Number.NEGATIVE_INFINITY)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((v) => v.voice);
}

export interface PickVoiceOptions {
  lang: Lang;
  gender: VoiceGender;
  /** Explicit voiceURI from settings ('' = auto). Also matched against the voice name. */
  preferredURI?: string;
  /** voiceURIs to skip (e.g. voices that failed this session). */
  exclude?: ReadonlySet<string>;
}

/** Best voice for the interviewer, or null (let the browser pick by `utterance.lang`). */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], opts: PickVoiceOptions): V | null {
  const usable = opts.exclude?.size ? voices.filter((v) => !opts.exclude?.has(v.voiceURI)) : voices;
  const preferred = opts.preferredURI?.trim();
  if (preferred) {
    const explicit = usable.find((v) => v.voiceURI === preferred) ?? usable.find((v) => v.name === preferred);
    if (explicit) return explicit;
  }
  return rankVoices(usable, opts.lang, opts.gender)[0] ?? null;
}
