import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createTts, type SpeechHandle } from '../../speech';
import { getSettings, useSettingsStore } from '../../store/settings';
import type { CharacterDef, Lang } from '../../types';

export interface InterviewerVoice {
  /**
   * Speak `text` (stops whatever is playing). Resolves when the line ends, is stopped or fails
   * — never rejects. Resolves immediately when there is no character.
   */
  speak: (text: string) => Promise<void>;
  /** Warm the TTS cache for the next page. */
  prefetch: (text: string) => void;
  stop: () => void;
  /** True while a line is being voiced. */
  speaking: boolean;
  /** Mouth openness 0–1 written by the TTS engine; pass to CharacterSprite.mouthLevelRef. */
  mouthLevelRef: { current: number };
  /** The engine voices nothing (TTS off): callers can animate the mouth while typing instead. */
  silent: boolean;
}

/** Effective voice volume: audio.voice × audio.master, 0 when muted. */
export function voiceVolume(): number {
  const { audio } = getSettings();
  return audio.muted ? 0 : Math.max(0, Math.min(1, audio.voice * audio.master));
}

/**
 * Owns the interviewer's TTS engine (re-created when the TTS settings change), speaks lines in the
 * interview language with the character's voice, and drives the sprite's lip-sync through a ref.
 * Everything stops on unmount.
 */
export function useInterviewerVoice(character: CharacterDef | null, lang: Lang): InterviewerVoice {
  const tts = useSettingsStore((s) => s.settings.tts);
  const engine = useMemo(() => createTts({ ...getSettings(), tts }), [tts]);
  const handleRef = useRef<SpeechHandle | null>(null);
  const mouthLevelRef = useRef(0);
  const [speaking, setSpeaking] = useState(false);

  useEffect(
    () => () => {
      handleRef.current = null;
      mouthLevelRef.current = 0;
      engine.stopAll();
    },
    [engine],
  );

  const stop = useCallback(() => {
    const h = handleRef.current;
    handleRef.current = null;
    mouthLevelRef.current = 0;
    setSpeaking(false);
    h?.stop();
  }, []);

  const speak = useCallback(
    (text: string): Promise<void> => {
      const line = text.trim();
      if (!character || !line) return Promise.resolve();
      handleRef.current?.stop();
      let handle: SpeechHandle;
      try {
        handle = engine.speak(line, {
          lang,
          character,
          volume: voiceVolume(),
          onStart: () => {
            if (handleRef.current === handle) setSpeaking(true);
          },
          onLevel: (level) => {
            if (handleRef.current === handle) mouthLevelRef.current = level;
          },
          onEnd: () => {
            if (handleRef.current === handle) {
              mouthLevelRef.current = 0;
              setSpeaking(false);
            }
          },
        });
      } catch (err) {
        // A broken engine must never break the scene: carry on silently.
        console.warn('[voice] speak failed', err);
        return Promise.resolve();
      }
      handleRef.current = handle;
      if (engine.kind !== 'off') setSpeaking(true);
      return handle.done.then(
        () => {
          if (handleRef.current === handle) {
            handleRef.current = null;
            mouthLevelRef.current = 0;
            setSpeaking(false);
          }
        },
        () => undefined,
      );
    },
    [character, engine, lang],
  );

  const prefetch = useCallback(
    (text: string) => {
      if (!character || !text.trim()) return;
      try {
        engine.prefetch(text.trim(), { lang, character });
      } catch {
        /* prefetch is best-effort */
      }
    },
    [character, engine, lang],
  );

  return { speak, prefetch, stop, speaking, mouthLevelRef, silent: engine.kind === 'off' };
}
