/**
 * Access to the global `speechSynthesis` and its (asynchronously loaded) voice list.
 * Voices arrive late in Chrome (`voiceschanged`) and without any event in some Safari versions,
 * so loading waits for the event, polls, and gives up after a timeout.
 */
import { nowMs } from '../env';

export const VOICE_WAIT_MS = 1500;
/** After a load found no voices at all, later loads only wait this long. */
const VOICE_REWAIT_MS = 250;
const VOICE_POLL_MS = 250;

interface SynthGlobals {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: unknown;
}

export function getSynth(): SpeechSynthesis | null {
  const g = globalThis as unknown as SynthGlobals;
  const synth = g.speechSynthesis;
  if (!synth || typeof synth.speak !== 'function' || typeof g.SpeechSynthesisUtterance !== 'function') return null;
  return synth;
}

export function isBrowserTtsSupported(): boolean {
  return getSynth() !== null;
}

let cachedVoices: SpeechSynthesisVoice[] = [];
let pendingLoad: Promise<SpeechSynthesisVoice[]> | null = null;
let foundNothing = false;
let watched = new WeakSet<SpeechSynthesis>();
let lastCancelAt = Number.NEGATIVE_INFINITY;

function readVoices(synth: SpeechSynthesis): SpeechSynthesisVoice[] {
  try {
    return synth.getVoices() ?? [];
  } catch {
    return [];
  }
}

function listen(synth: SpeechSynthesis, fn: () => void): () => void {
  if (typeof synth.addEventListener !== 'function') return () => {};
  synth.addEventListener('voiceschanged', fn);
  return () => synth.removeEventListener('voiceschanged', fn);
}

/** Keep the cache fresh when voices change later (e.g. language packs installed, Edge online voices). */
function watchVoices(synth: SpeechSynthesis): void {
  if (watched.has(synth)) return;
  watched.add(synth);
  listen(synth, () => {
    const voices = readVoices(synth);
    if (voices.length) {
      cachedVoices = voices;
      foundNothing = false;
    }
  });
}

/** The browser's voices; waits up to `timeoutMs` for them to load. [] when unsupported. */
export function loadVoices(timeoutMs: number = VOICE_WAIT_MS): Promise<SpeechSynthesisVoice[]> {
  const found = getSynth();
  if (!found) return Promise.resolve([]);
  const synth: SpeechSynthesis = found;
  watchVoices(synth);
  const immediate = readVoices(synth);
  if (immediate.length) {
    cachedVoices = immediate;
    foundNothing = false;
    return Promise.resolve(immediate);
  }
  if (pendingLoad) return pendingLoad;
  const wait = foundNothing ? Math.min(timeoutMs, VOICE_REWAIT_MS) : timeoutMs;
  pendingLoad = new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let settled = false;
    const check = (): void => {
      if (readVoices(synth).length) finish();
    };
    const unlisten = listen(synth, check);
    const poll = setInterval(check, VOICE_POLL_MS);
    const timer = setTimeout(() => finish(), wait);
    function finish(): void {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      unlisten();
      pendingLoad = null;
      const voices = readVoices(synth);
      if (voices.length) cachedVoices = voices;
      foundNothing = voices.length === 0 && cachedVoices.length === 0;
      resolve(voices.length ? voices : cachedVoices);
    }
  });
  return pendingLoad;
}

/** While someone watches the list, also poll this long (some Safari versions never fire voiceschanged). */
export const VOICE_WATCH_POLL_MS = 500;
export const VOICE_WATCH_POLL_FOR_MS = 15_000;

function voiceSignature(voices: readonly SpeechSynthesisVoice[]): string {
  return voices.map((v) => `${v.voiceURI}\u0001${v.name}\u0001${v.lang}`).join('\u0002');
}

/**
 * Call `cb` with the fresh voice list whenever it changes: checked on every `voiceschanged` event
 * and by a short poll (browsers that add voices without the event). The first non-empty list is
 * delivered even if it is already there when subscribing, so a subscriber that read an empty
 * list just before the voices arrived still gets them. An initial empty list is never delivered.
 * Returns the unsubscribe function; a no-op when speechSynthesis is unavailable.
 */
export function watchVoiceList(cb: (voices: SpeechSynthesisVoice[]) => void): () => void {
  const synth = getSynth();
  if (!synth) return () => {};
  watchVoices(synth);
  let active = true;
  let lastDelivered: string | null = null;
  const deliver = (): void => {
    if (!active) return;
    const voices = readVoices(synth);
    const signature = voiceSignature(voices);
    if (signature === lastDelivered) return;
    if (lastDelivered === null && voices.length === 0) return;
    lastDelivered = signature;
    if (voices.length) {
      cachedVoices = voices;
      foundNothing = false;
    }
    try {
      cb(voices);
    } catch (err) {
      console.error('[speech] voices callback threw', err);
    }
  };
  const unlisten = listen(synth, deliver);
  const startedAt = nowMs();
  const poll = setInterval(() => {
    deliver();
    if (nowMs() - startedAt >= VOICE_WATCH_POLL_FOR_MS) clearInterval(poll);
  }, VOICE_WATCH_POLL_MS);
  return () => {
    if (!active) return;
    active = false;
    clearInterval(poll);
    unlisten();
  };
}

/** speechSynthesis.cancel(), remembering when (Chrome drops an utterance spoken right after a cancel). */
export function cancelSynth(synth: SpeechSynthesis): void {
  lastCancelAt = nowMs();
  try {
    synth.cancel();
  } catch {
    /* ignore */
  }
}

export function msSinceLastCancel(): number {
  return nowMs() - lastCancelAt;
}

/** Test helper: forget cached voices and timing state. */
export function resetBrowserSynthState(): void {
  cachedVoices = [];
  pendingLoad = null;
  foundNothing = false;
  watched = new WeakSet();
  lastCancelAt = Number.NEGATIVE_INFINITY;
}
