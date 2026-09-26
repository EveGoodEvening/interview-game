import { describe, expect, it } from 'vitest';
import { makeVoice } from '../testing/fakes';
import { guessVoiceGender, langScore, pickVoice, rankVoices } from './voicePicker';

const edgeVoices = [
  makeVoice('Microsoft Yunxi Online (Natural) - Chinese (Mainland)', 'zh-CN', { localService: false }),
  makeVoice('Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)', 'zh-CN', { localService: false }),
  makeVoice('Microsoft HiuGaai Online (Natural) - Chinese (Cantonese Traditional)', 'zh-HK', { localService: false }),
  makeVoice('Microsoft Aria Online (Natural) - English (United States)', 'en-US', { localService: false }),
  makeVoice('Microsoft Guy Online (Natural) - English (United States)', 'en-US', { localService: false }),
  makeVoice('Microsoft Liam Online (Natural) - English (Canada)', 'en-CA', { localService: false }),
];

const chromeWindowsVoices = [
  makeVoice('Microsoft Huihui - Chinese (Simplified, PRC)', 'zh-CN', { default: true }),
  makeVoice('Microsoft Kangkang - Chinese (Simplified, PRC)', 'zh-CN'),
  makeVoice('Microsoft David - English (United States)', 'en-US'),
  makeVoice('Microsoft Zira - English (United States)', 'en-US'),
  makeVoice('Google US English', 'en-US', { localService: false }),
  makeVoice('Google UK English Male', 'en-GB', { localService: false }),
  makeVoice('Google 普通话（中国大陆）', 'zh-CN', { localService: false }),
  makeVoice('Google 國語（臺灣）', 'zh-TW', { localService: false }),
];

describe('langScore', () => {
  it('orders zh-CN > zh-* > cmn and puts Cantonese last', () => {
    expect(langScore('zh-CN', 'zh')).toBeGreaterThan(langScore('zh-TW', 'zh'));
    expect(langScore('zh_TW', 'zh')).toBeGreaterThan(langScore('cmn-Hans-CN', 'zh'));
    expect(langScore('cmn-Hans-CN', 'zh')).toBeGreaterThan(langScore('zh-HK', 'zh'));
    expect(langScore('en-US', 'zh')).toBe(0);
  });

  it('orders en-US > en-GB > other en-*', () => {
    expect(langScore('en-US', 'en')).toBeGreaterThan(langScore('en-GB', 'en'));
    expect(langScore('en-GB', 'en')).toBeGreaterThan(langScore('en-AU', 'en'));
    expect(langScore('zh-CN', 'en')).toBe(0);
  });
});

describe('guessVoiceGender', () => {
  it('recognises common voice names', () => {
    expect(guessVoiceGender({ name: 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)' }, 'zh')).toBe('female');
    expect(guessVoiceGender({ name: 'Microsoft Yunxi Online (Natural) - Chinese (Mainland)' }, 'zh')).toBe('male');
    expect(guessVoiceGender({ name: 'Ting-Ting' }, 'zh')).toBe('female');
    expect(guessVoiceGender({ name: 'Google UK English Male' }, 'en')).toBe('male');
    expect(guessVoiceGender({ name: 'Google UK English Female' }, 'en')).toBe('female');
    expect(guessVoiceGender({ name: 'Samantha' }, 'en')).toBe('female');
    expect(guessVoiceGender({ name: 'Alex' }, 'en')).toBe('male');
  });

  it('matches whole words, not substrings ("Canada" is not "Ana")', () => {
    expect(guessVoiceGender({ name: 'Microsoft Liam Online (Natural) - English (Canada)' }, 'en')).toBe('male');
    expect(guessVoiceGender({ name: 'Some Voice - English (Canada)' }, 'en')).toBeNull();
  });
});

describe('pickVoice', () => {
  it('prefers natural online voices of the right gender (Edge)', () => {
    expect(pickVoice(edgeVoices, { lang: 'zh', gender: 'female' })?.name).toContain('Xiaoxiao');
    expect(pickVoice(edgeVoices, { lang: 'zh', gender: 'male' })?.name).toContain('Yunxi');
    expect(pickVoice(edgeVoices, { lang: 'en', gender: 'female' })?.name).toContain('Aria');
    expect(pickVoice(edgeVoices, { lang: 'en', gender: 'male' })?.name).toContain('Guy');
  });

  it('picks a gender-matching local voice over an opposite-gender Google voice (Chrome/Windows)', () => {
    expect(pickVoice(chromeWindowsVoices, { lang: 'zh', gender: 'male' })?.name).toContain('Kangkang');
    expect(pickVoice(chromeWindowsVoices, { lang: 'zh', gender: 'female' })?.name).toContain('Google 普通话');
    expect(pickVoice(chromeWindowsVoices, { lang: 'en', gender: 'female' })?.name).toBe('Google US English');
    expect(pickVoice(chromeWindowsVoices, { lang: 'en', gender: 'male' })?.name).toContain('David');
  });

  it('uses an explicit voiceURI when present, else falls back to auto', () => {
    expect(pickVoice(chromeWindowsVoices, { lang: 'zh', gender: 'male', preferredURI: 'Google 國語（臺灣）' })?.name).toBe(
      'Google 國語（臺灣）',
    );
    expect(pickVoice(chromeWindowsVoices, { lang: 'zh', gender: 'male', preferredURI: 'missing-voice' })?.name).toContain(
      'Kangkang',
    );
  });

  it('skips excluded voices and returns null when no language matches', () => {
    const exclude = new Set(['Google 普通话（中国大陆）']);
    expect(pickVoice(chromeWindowsVoices, { lang: 'zh', gender: 'female', exclude })?.name).toContain('Huihui');
    expect(pickVoice([makeVoice('Anna', 'de-DE')], { lang: 'en', gender: 'female' })).toBeNull();
    expect(pickVoice([], { lang: 'zh', gender: 'female' })).toBeNull();
  });

  it('penalises novelty voices', () => {
    const voices = [makeVoice('Zarvox', 'en-US'), makeVoice('Bad News', 'en-US'), makeVoice('Fred', 'en-US')];
    expect(pickVoice(voices, { lang: 'en', gender: 'male' })?.name).toBe('Fred');
  });

  it('rankVoices keeps only matching languages, best first (gender outweighs zh-CN vs zh-TW)', () => {
    const ranked = rankVoices(chromeWindowsVoices, 'zh', 'female').map((v) => v.name);
    expect(ranked).toEqual([
      'Google 普通话（中国大陆）',
      'Microsoft Huihui - Chinese (Simplified, PRC)',
      'Google 國語（臺灣）',
      'Microsoft Kangkang - Chinese (Simplified, PRC)',
    ]);
  });
});
