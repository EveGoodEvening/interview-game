import { describe, expect, it } from 'vitest';
import {
  BGM_TRACKS,
  currentBgm,
  getAudioContext,
  isAudioUnlocked,
  playBgm,
  playSfx,
  setAudioVolumes,
  SFX_NAMES,
  unlockAudio,
} from './index';

describe('audio public API without Web Audio (Node)', () => {
  it('never throws and stays silent', () => {
    expect(() => {
      unlockAudio();
      unlockAudio();
      setAudioVolumes({ master: 1, bgm: 1, sfx: 1, voice: 1, muted: false });
      setAudioVolumes({ master: Number.NaN, bgm: -1, sfx: 2, voice: 1, muted: true });
      for (const name of SFX_NAMES) playSfx(name);
      for (const track of BGM_TRACKS) playBgm(track);
      playBgm(null);
    }).not.toThrow();
    expect(getAudioContext()).toBeNull();
    expect(isAudioUnlocked()).toBe(false);
  });

  it('remembers the requested BGM track for when audio becomes available', () => {
    playBgm('interview');
    expect(currentBgm()).toBe('interview');
    playBgm('interview');
    expect(currentBgm()).toBe('interview');
    playBgm(null);
    expect(currentBgm()).toBeNull();
  });
});
