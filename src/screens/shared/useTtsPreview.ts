import { useCallback, useEffect, useRef, useState } from 'react';
import { unlockAudio } from '../../audio';
import { createTts, voiceVolume, type SpeechHandle } from '../../speech';
import { getSettings } from '../../store/settings';
import type { CharacterDef, Lang, Settings } from '../../types';

export interface PreviewRequest {
  text: string;
  lang: Lang;
  character: CharacterDef;
  /** Settings to preview with (defaults to the live settings). */
  settings?: Settings;
  /** The configured voice failed and a fallback was used. */
  onFallback?: (error: Error) => void;
}

/**
 * Speak short preview lines (settings / device check). Only one preview plays at a time; it
 * stops when the component unmounts. `speakingId` tells which button is currently playing.
 */
export function useTtsPreview() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const handleRef = useRef<SpeechHandle | null>(null);

  const stop = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setSpeakingId(null);
  }, []);

  useEffect(
    () => () => {
      handleRef.current?.stop();
      handleRef.current = null;
    },
    [],
  );

  const speak = useCallback((id: string, req: PreviewRequest) => {
    handleRef.current?.stop();
    handleRef.current = null;
    const settings = req.settings ?? getSettings();
    unlockAudio();
    let handle: SpeechHandle;
    try {
      handle = createTts(settings).speak(req.text, {
        lang: req.lang,
        character: req.character,
        volume: voiceVolume(settings.audio),
        onFallback: req.onFallback,
      });
    } catch (err) {
      req.onFallback?.(err instanceof Error ? err : new Error(String(err)));
      setSpeakingId(null);
      return;
    }
    handleRef.current = handle;
    setSpeakingId(id);
    void handle.done.then(() => {
      if (handleRef.current !== handle) return;
      handleRef.current = null;
      setSpeakingId(null);
    });
  }, []);

  return { speakingId, speak, stop };
}
