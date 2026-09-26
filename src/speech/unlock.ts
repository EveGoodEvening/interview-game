/**
 * Unlocking speech output inside a user gesture (iOS / iPadOS Safari and other WebKit builds that
 * require one; harmless elsewhere).
 *
 * - speechSynthesis (iOS / iPadOS WebKit only — every browser there): speak() is silently dropped
 *   (no start / error event) until one speak() ran inside a gesture; after that the page may speak
 *   freely. A silent one-space utterance lifts it. Until the engine reacts to a priming utterance
 *   (start / end / an error other than 'not-allowed'), later gestures prime again (a gesture WebKit
 *   did not count leaves it locked). Other browsers only need *some* earlier user activation, so
 *   nothing is spoken there.
 * - API TTS audio: an <audio> element may only be played by script once it was played inside a
 *   gesture, so one reusable element is primed (audioPlayer.ts), again until that succeeded.
 * - The speech AudioContext (analyser routing for API-TTS lip-sync, the mic level meter) is created
 *   and started inside the gesture when a speech engine that uses it is selected (API TTS, or any
 *   recognition engine but the keyboard); an existing one is resumed. With browser TTS + keyboard
 *   no context is created, so no idle audio thread runs for nothing.
 *
 * `unlockSpeech()` must be called synchronously from a user-gesture handler (the app calls it next
 * to `unlockAudio()` on mousedown / pointerup / touchend / non-Esc keydown). Idempotent and cheap
 * once everything is primed. No-op in node.
 */
import { getSettings } from '../store/settings';
import { getSpeechAudioContext, peekSpeechAudioContext } from './audioLevel';
import { primeAudioElement } from './tts/audioPlayer';
import { getSynth } from './tts/browserSynth';

/** Give up priming speechSynthesis after this many attempts without any reaction. */
export const MAX_SYNTH_PRIMES = 10;

let synthConfirmed = false;
let synthAttempts = 0;
/** GC guard for the priming utterance (Chrome loses events of collected utterances). */
let primingUtterance: SpeechSynthesisUtterance | null = null;
let primedContext: AudioContext | null = null;

/** iOS / iPadOS (WebKit, whatever the browser): speechSynthesis needs a speak() inside a gesture. */
export function isIosWebKit(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> | undefined = globalThis.navigator): boolean {
  if (!nav || typeof nav.userAgent !== 'string') return false;
  if (/\b(iPad|iPhone|iPod)\b/.test(nav.userAgent)) return true;
  // iPadOS 13+ presents a desktop Mac user agent; only its touch support gives it away.
  return /\bMacintosh\b/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1;
}

function primeSynth(): void {
  if (synthConfirmed || synthAttempts >= MAX_SYNTH_PRIMES || !isIosWebKit()) return;
  const synth = getSynth();
  if (!synth) return;
  // Something is speaking: speech output works (and speaking now would queue behind it).
  if (synth.speaking) {
    synthConfirmed = true;
    return;
  }
  if (synth.pending) return;
  synthAttempts += 1;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    const settle = (confirmed: boolean): void => {
      if (confirmed) synthConfirmed = true;
      if (primingUtterance === u) primingUtterance = null;
      u.onstart = null;
      u.onend = null;
      u.onerror = null;
    };
    u.onstart = () => settle(true);
    u.onend = () => settle(true);
    // 'not-allowed': the browser did not see a gesture (Chrome) — try again on the next one.
    u.onerror = (ev) => settle(ev.error !== 'not-allowed');
    primingUtterance = u;
    synth.speak(u);
  } catch {
    primingUtterance = null;
  }
}

/** A speech engine that routes audio through the speech AudioContext is selected. */
function speechContextWanted(): boolean {
  try {
    const { tts, stt } = getSettings();
    return tts.engine === 'api' || stt.engine !== 'keyboard';
  } catch {
    return false;
  }
}

function primeContext(): void {
  const ctx = speechContextWanted() ? getSpeechAudioContext() : peekSpeechAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state !== 'running') ctx.resume().catch(() => undefined);
    if (primedContext === ctx) return;
    primedContext = ctx;
    // Old WebKit only starts output after something plays inside the gesture.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    /* a context that refuses to start stays as it is; playback falls back to plain elements */
  }
}

/** Prime speech output from a user gesture (see module doc). Safe to call on every gesture. */
export function unlockSpeech(): void {
  for (const prime of [primeSynth, primeAudioElement, primeContext]) {
    try {
      prime();
    } catch {
      /* never let unlocking break the gesture handler */
    }
  }
}

/** Test helper: forget what was primed. */
export function resetSpeechUnlockState(): void {
  synthConfirmed = false;
  synthAttempts = 0;
  primingUtterance = null;
  primedContext = null;
}
