/**
 * Synthesized sound effects + procedural BGM (Web Audio, no asset files).
 * OWNER: resume+audio agent. Keep exported signatures stable.
 *
 * Every function is safe to call at any time: before unlock, in Node/SSR, in browsers without
 * Web Audio — they never throw. `playBgm` before unlock remembers the track and starts it on
 * unlock. In the browser, the first pointer/key gesture unlocks audio automatically; calling
 * `unlockAudio()` yourself is still fine (and cheap).
 */
import type { AudioSettings } from '../types';
import { AudioEngine, type DocumentLike } from './engine';
import type { BgmTrack, SfxName } from './types';

export type { BgmTrack, SfxName } from './types';
export { BGM_TRACKS, SFX_NAMES } from './types';

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

let engine: AudioEngine | null = null;

function getEngine(): AudioEngine {
  engine ??= new AudioEngine({
    createContext: () => {
      const Ctor = audioContextCtor();
      return Ctor ? new Ctor({ latencyHint: 'interactive' }) : null;
    },
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    document: typeof document !== 'undefined' ? (document as DocumentLike) : null,
  });
  return engine;
}

/** Must be called from a user gesture once (browsers block audio before that). Safe to call repeatedly. */
export function unlockAudio(): void {
  if (!audioContextCtor()) return;
  getEngine().unlock();
}

export function setAudioVolumes(volumes: AudioSettings): void {
  getEngine().setVolumes(volumes);
}

export function playSfx(name: SfxName): void {
  engine?.playSfx(name);
}

/** Crossfade to a track; null stops music. Calling with the current track is a no-op. */
export function playBgm(track: BgmTrack | null): void {
  getEngine().playBgm(track);
}

/** The shared AudioContext once unlocked (e.g. for analysers), else null. */
export function getAudioContext(): AudioContext | null {
  return engine?.context ?? null;
}

/** True once audio is unlocked and running. */
export function isAudioUnlocked(): boolean {
  return engine?.isUnlocked ?? false;
}

/** The requested BGM track (null = silence), even before unlock. */
export function currentBgm(): BgmTrack | null {
  return engine?.currentBgm ?? null;
}

// Unlock on the first user gesture (and re-resume after iOS interruptions) without relying on
// every caller to remember it. Capture phase, so it runs before click handlers play a sound.
// Only events that grant "user activation" are used (touch-down and Esc do not), so the browser
// never warns about an AudioContext created too early.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const onGesture = (event: Event) => {
    if (event.type === 'keydown' && (event as KeyboardEvent).key === 'Escape') return;
    if (!engine?.isUnlocked) unlockAudio();
  };
  for (const type of ['mousedown', 'pointerup', 'touchend', 'keydown'] as const) {
    window.addEventListener(type, onGesture, { capture: true, passive: true });
  }
}
