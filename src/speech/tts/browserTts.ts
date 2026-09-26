/**
 * Browser TTS (speechSynthesis) with the usual Chrome workarounds:
 *  - long text is spoken in short sentence-aligned chunks (textChunks.ts);
 *  - utterances are kept in a module-level set while speaking (Chrome garbage-collects them and
 *    never fires onend otherwise);
 *  - cancel() before speaking, and a short pause after a cancel (an utterance spoken right after
 *    cancel() is sometimes dropped);
 *  - a keep-alive timer: resume() when stuck paused, pause()+resume() for network voices which
 *    Chrome cuts off after ~15 s;
 *  - a watchdog for a missing onstart / onend;
 *  - onerror 'interrupted' / 'canceled' is a normal stop, not a failure;
 *  - when a voice errors (e.g. Google voices unreachable), retry the chunk once with the next
 *    best voice, then continue silently for the remaining reading time so pacing is kept. The
 *    automatic pick skips a failed voice for VOICE_BACKOFF_MS (not for the page lifetime); the voice
 *    the player chose in Settings is still tried first, until it failed PREFERRED_VOICE_STRIKES
 *    times in a row for the same engine (PreferredVoiceStrikes);
 *  - a chunk that never starts ('no-start': iOS drops speak() outside a user gesture until
 *    unlockSpeech() ran, see unlock.ts) is an engine problem, not a voice fault: no voice is
 *    blamed or swapped, the line continues silently.
 * Lip-sync is synthetic (lipSync.ts): oscillation while speaking plus onboundary pulses.
 */
import type { CharacterDef, Lang, Settings } from '../../types';
import { clamp, clamp01, currentVoiceVolume, delay, nowMs, SPEECH_LANG_TAG } from '../env';
import type { TtsEngine } from '../types';
import { cancelSynth, getSynth, isBrowserTtsSupported, loadVoices, msSinceLastCancel } from './browserSynth';
import { createSyntheticLipSync, type SyntheticLipSync } from './lipSync';
import { deferred, runUtterance, startSilentWait, stopActiveVoice, type Playback, type PlaybackHooks } from './playback';
import { estimateReadingMs } from './silentTts';
import { cleanForSpeech, splitIntoChunks } from './textChunks';
import { pickVoice } from './voicePicker';

/** Chrome drops an utterance spoken within a few ms of cancel(). */
const CANCEL_SETTLE_MS = 80;
const WATCH_INTERVAL_MS = 400;
/** Treat the chunk as started if the synth reports speaking but onstart never came. */
const START_EVENT_GRACE_MS = 1200;
/** Give up on a chunk that never starts. */
const NO_START_TIMEOUT_MS = 4000;
/** Keep-alive period (Chrome cuts network voices after ~15 s). */
const KEEPALIVE_MS = 10_000;
/** A chunk "speaking" far longer than its reading time is stalled (e.g. unreachable network voice). */
const STALL_FACTOR = 3;
const STALL_EXTRA_MS = 8000;

export interface BrowserSpeechParams extends Partial<PlaybackHooks> {
  /** Text to speak (cleaned or not; it is chunked here). */
  text: string;
  lang: Lang;
  character: CharacterDef;
  /** 0–1, already includes master volume / mute. */
  volume: number;
  /** User speed multiplier (settings.tts.rate); multiplied by the character's rate. */
  userRate: number;
  /** settings.tts.browserVoice[lang]; '' = auto. */
  voiceURI: string;
  /** The engine's failure count for `voiceURI` (default: a fresh one, i.e. always try it first). */
  strikes?: PreferredVoiceStrikes;
}

type ChunkOutcome = { kind: 'ended' } | { kind: 'interrupted' } | { kind: 'error'; code: string };

/** GC guard: Chrome loses events of utterances that are garbage-collected mid-speech. */
const liveUtterances = new Set<SpeechSynthesisUtterance>();
/** A voice that failed (e.g. a Google network voice without access to Google) is skipped this long. */
export const VOICE_BACKOFF_MS = 3 * 60_000;
/** An engine stops trying the voice chosen in Settings after this many failures in a row. */
export const PREFERRED_VOICE_STRIKES = 2;

/** Recently failed voices, shared by every engine: voiceURI → time until the automatic pick skips it. */
const voiceBackoff = new Map<string, number>();
let warnedDegrade = false;

/** Worth retrying the chunk (once). A chunk that never started is not: the engine is not speaking at all. */
function isRetryable(code: string): boolean {
  return code !== 'not-allowed' && code !== 'text-too-long' && code !== 'no-start';
}

/** The voice itself is to blame (vs. the output device): retry with another voice and back off. */
function isVoiceFault(code: string): boolean {
  return code !== 'audio-busy' && code !== 'audio-hardware';
}

/** voiceURIs the automatic pick skips right now (expired entries are dropped). */
function backedOffVoices(): Set<string> {
  const now = nowMs();
  const out = new Set<string>();
  for (const [uri, until] of voiceBackoff) {
    if (until <= now) voiceBackoff.delete(uri);
    else out.add(uri);
  }
  return out;
}

/**
 * Failures in a row of the voice chosen in Settings, counted per engine. The interviewer's engine
 * gives up on a broken choice after PREFERRED_VOICE_STRIKES (for VOICE_BACKOFF_MS), while a fresh
 * engine — a Settings preview, the engine of a new interview or of changed voice settings — always
 * tries the chosen voice first, so re-selecting or previewing it works at once.
 */
export class PreferredVoiceStrikes {
  private readonly failures = new Map<string, { count: number; until: number }>();

  note(uri: string): void {
    const now = nowMs();
    const prev = this.failures.get(uri);
    const count = prev && prev.until > now ? prev.count + 1 : 1;
    this.failures.set(uri, { count, until: now + VOICE_BACKOFF_MS });
  }

  clear(uri: string): void {
    this.failures.delete(uri);
  }

  isBlocked(uri: string): boolean {
    const failure = this.failures.get(uri);
    if (!failure) return false;
    if (failure.until <= nowMs()) {
      this.failures.delete(uri);
      return false;
    }
    return failure.count >= PREFERRED_VOICE_STRIKES;
  }
}

/**
 * Forget which voices failed recently, so the automatic pick tries every voice again at once.
 * Failures also expire on their own after VOICE_BACKOFF_MS.
 */
export function resetVoiceFailures(): void {
  voiceBackoff.clear();
}

function keepAlive(synth: SpeechSynthesis, voice: SpeechSynthesisVoice | null): void {
  try {
    if (synth.paused) synth.resume();
    else if (voice && !voice.localService) {
      synth.pause();
      synth.resume();
    } else synth.resume();
  } catch {
    /* ignore */
  }
}

class BrowserSpeech implements Playback {
  readonly done: Promise<void>;
  private readonly resolveDone: () => void;
  private readonly synth: SpeechSynthesis;
  private readonly p: BrowserSpeechParams;
  private readonly lip: SyntheticLipSync;
  private readonly rate: number;
  private readonly pitch: number;
  private readonly strikes: PreferredVoiceStrikes;
  private finished = false;
  private started = false;
  private abortChunk: (() => void) | null = null;
  private silent: Playback | null = null;

  constructor(synth: SpeechSynthesis, params: BrowserSpeechParams) {
    const d = deferred();
    this.done = d.promise;
    this.resolveDone = d.resolve;
    this.synth = synth;
    this.p = params;
    this.lip = createSyntheticLipSync(params.onLevel);
    this.rate = clamp(params.character.voice.rate * params.userRate, 0.5, 2);
    this.pitch = clamp(params.character.voice.pitch, 0, 2);
    this.strikes = params.strikes ?? new PreferredVoiceStrikes();
    this.run().catch((err: unknown) => {
      console.error('[speech] browser TTS crashed', err);
      this.finish();
    });
  }

  stop(): void {
    if (this.finished) return;
    this.finish();
    cancelSynth(this.synth);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    const abort = this.abortChunk;
    this.abortChunk = null;
    abort?.();
    this.silent?.stop();
    this.silent = null;
    this.lip.stop();
    this.resolveDone();
  }

  private markStarted(): void {
    if (this.started) return;
    this.started = true;
    this.p.onStart?.();
  }

  /** The voice chosen in Settings, if it is installed. */
  private explicitVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
    const uri = this.p.voiceURI.trim();
    if (!uri) return undefined;
    return voices.find((v) => v.voiceURI === uri) ?? voices.find((v) => v.name === uri);
  }

  /**
   * `allowPreferred`: the first attempt of a line uses the voice chosen in Settings even if it
   * failed recently (unless it failed PREFERRED_VOICE_STRIKES times in a row for this engine); the
   * in-line retry never does and skips every recently failed voice.
   */
  private chooseVoice(voices: readonly SpeechSynthesisVoice[], allowPreferred: boolean): SpeechSynthesisVoice | null {
    const exclude = backedOffVoices();
    const explicit = allowPreferred ? this.explicitVoice(voices) : undefined;
    if (explicit) {
      if (this.strikes.isBlocked(explicit.voiceURI)) exclude.add(explicit.voiceURI);
      else exclude.delete(explicit.voiceURI);
    }
    return pickVoice(voices, {
      lang: this.p.lang,
      gender: this.p.character.voice.gender,
      preferredURI: explicit?.voiceURI ?? '',
      exclude,
    });
  }

  private noteFailure(voice: SpeechSynthesisVoice): void {
    voiceBackoff.set(voice.voiceURI, nowMs() + VOICE_BACKOFF_MS);
    if (voice.voiceURI === this.explicitVoice([voice])?.voiceURI) this.strikes.note(voice.voiceURI);
  }

  private noteSuccess(voice: SpeechSynthesisVoice): void {
    voiceBackoff.delete(voice.voiceURI);
    this.strikes.clear(voice.voiceURI);
  }

  private async settleAfterCancel(): Promise<void> {
    const wait = CANCEL_SETTLE_MS - msSinceLastCancel();
    if (wait > 0) await delay(wait);
  }

  private async run(): Promise<void> {
    const chunks = splitIntoChunks(this.p.text);
    if (chunks.length === 0) return this.finish();
    const voices = await loadVoices();
    if (this.finished) return;
    let voice = this.chooseVoice(voices, true);

    if (this.synth.speaking || this.synth.pending) cancelSynth(this.synth);
    if (this.synth.paused) keepAlive(this.synth, null);
    await this.settleAfterCancel();

    for (let i = 0; i < chunks.length; i++) {
      if (this.finished) return;
      const chunkStart = nowMs();
      let outcome = await this.speakChunk(chunks[i], voice);
      if (this.finished) return;
      if (outcome.kind === 'error' && voice && isRetryable(outcome.code)) {
        if (isVoiceFault(outcome.code)) {
          this.noteFailure(voice);
          voice = this.chooseVoice(voices, false);
        }
        await this.settleAfterCancel();
        if (this.finished) return;
        outcome = await this.speakChunk(chunks[i], voice);
        if (this.finished) return;
      }
      if (outcome.kind === 'ended' && voice) this.noteSuccess(voice);
      // Someone else cancelled speechSynthesis: that is a stop, not a failure.
      if (outcome.kind === 'interrupted') return this.finish();
      if (outcome.kind === 'error') return this.degrade(chunks.slice(i), outcome.code, nowMs() - chunkStart);
    }
    this.finish();
  }

  /** Voice failed for good: keep the pacing with a silent wait for the unspoken text. */
  private async degrade(remaining: readonly string[], code: string, alreadySpentMs: number): Promise<void> {
    if (!warnedDegrade) {
      warnedDegrade = true;
      console.warn(`[speech] speechSynthesis failed (${code}); continuing without voice.`);
    }
    this.p.onFallback?.(new Error(`speechSynthesis error: ${code}`));
    this.lip.setSpeaking(false);
    this.markStarted();
    const ms = Math.max(0, estimateReadingMs(remaining.join(' '), this.rate) - alreadySpentMs);
    const wait = startSilentWait(ms);
    this.silent = wait;
    await wait.done;
    this.finish();
  }

  private speakChunk(text: string, voice: SpeechSynthesisVoice | null): Promise<ChunkOutcome> {
    return new Promise<ChunkOutcome>((resolve) => {
      const synth = this.synth;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = voice?.lang || SPEECH_LANG_TAG[this.p.lang];
      if (voice) u.voice = voice;
      u.rate = this.rate;
      u.pitch = this.pitch;
      u.volume = clamp01(this.p.volume);

      const spokeAt = nowMs();
      const stallAfterMs = estimateReadingMs(text, this.rate) * STALL_FACTOR + STALL_EXTRA_MS;
      let lastKeepAlive = spokeAt;
      let chunkStarted = false;
      let quietTicks = 0;
      let settled = false;
      let watch: ReturnType<typeof setInterval> | null = null;

      const settle = (outcome: ChunkOutcome): void => {
        if (settled) return;
        settled = true;
        if (watch !== null) clearInterval(watch);
        u.onstart = null;
        u.onend = null;
        u.onerror = null;
        u.onboundary = null;
        liveUtterances.delete(u);
        if (this.abortChunk === abort) this.abortChunk = null;
        this.lip.setSpeaking(false);
        resolve(outcome);
      };
      const abort = (): void => settle({ kind: 'interrupted' });
      const markChunkStarted = (): void => {
        if (chunkStarted) return;
        chunkStarted = true;
        this.markStarted();
        this.lip.setSpeaking(true);
      };

      u.onstart = markChunkStarted;
      u.onboundary = (ev) => {
        if (!ev.name || ev.name === 'word') this.lip.pulse();
      };
      u.onend = () => settle({ kind: 'ended' });
      u.onerror = (ev) => {
        const code = ev.error || 'unknown';
        settle(code === 'interrupted' || code === 'canceled' ? { kind: 'interrupted' } : { kind: 'error', code });
      };

      watch = setInterval(() => {
        const t = nowMs();
        const elapsed = t - spokeAt;
        const speaking = synth.speaking;
        if (!chunkStarted) {
          if (speaking && !synth.paused && elapsed > START_EVENT_GRACE_MS) markChunkStarted();
          else if (elapsed > NO_START_TIMEOUT_MS) {
            cancelSynth(synth);
            settle({ kind: 'error', code: 'no-start' });
            return;
          }
        } else if (!speaking && !synth.pending) {
          // Finished without onend (GC'd utterance / engine bug): two quiet ticks in a row.
          quietTicks += 1;
          if (quietTicks >= 2) {
            settle({ kind: 'ended' });
            return;
          }
        } else {
          quietTicks = 0;
          if (elapsed > stallAfterMs) {
            cancelSynth(synth);
            settle({ kind: 'error', code: 'stalled' });
            return;
          }
        }
        if (chunkStarted && speaking && t - lastKeepAlive >= KEEPALIVE_MS) {
          lastKeepAlive = t;
          keepAlive(synth, voice);
        }
      }, WATCH_INTERVAL_MS);

      liveUtterances.add(u);
      this.abortChunk = abort;
      try {
        synth.speak(u);
      } catch (err) {
        console.warn('[speech] speechSynthesis.speak threw', err);
        settle({ kind: 'error', code: 'speak-threw' });
      }
    });
  }
}

/**
 * Low-level browser speech (no voice-channel ownership). Falls back to a silent wait with the
 * reading-time estimate when speechSynthesis is unavailable.
 */
export function startBrowserPlayback(params: BrowserSpeechParams): Playback {
  const synth = getSynth();
  if (!synth) {
    params.onFallback?.(new Error('speechSynthesis is not supported in this browser'));
    const rate = params.character.voice.rate * params.userRate;
    return startSilentWait(estimateReadingMs(cleanForSpeech(params.text), rate), params.onStart);
  }
  return new BrowserSpeech(synth, params);
}

export function createBrowserTts(settings: Settings): TtsEngine {
  const tts = settings.tts;
  const strikes = new PreferredVoiceStrikes();
  if (isBrowserTtsSupported()) void loadVoices();
  return {
    kind: 'browser',
    isAvailable: isBrowserTtsSupported,
    speak: (text, opts) =>
      runUtterance(opts, (hooks) =>
        startBrowserPlayback({
          ...hooks,
          text,
          lang: opts.lang,
          character: opts.character,
          volume: opts.volume ?? currentVoiceVolume(settings.audio),
          userRate: tts.rate,
          voiceURI: tts.browserVoice?.[opts.lang] ?? '',
          strikes,
        }),
      ),
    prefetch: () => {
      if (isBrowserTtsSupported()) void loadVoices();
    },
    stopAll: () => {
      stopActiveVoice();
      const synth = getSynth();
      if (synth && (synth.speaking || synth.pending)) cancelSynth(synth);
    },
  };
}

/** Test helper: forget voices that failed and the one-time warning. */
export function resetBrowserTtsState(): void {
  voiceBackoff.clear();
  liveUtterances.clear();
  warnedDegrade = false;
}
