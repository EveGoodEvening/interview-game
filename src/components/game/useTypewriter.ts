import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface TypewriterOptions {
  /** Characters per second; 0 (or negative) = show instantly. */
  cps: number;
  /** While true nothing is revealed (e.g. a chapter card is on screen). */
  paused?: boolean;
  /** Show the full text at once (reduce-motion). */
  instant?: boolean;
  /** Called every `blipEvery` revealed visible characters — used for the quiet typing SFX. */
  onBlip?: () => void;
  blipEvery?: number;
}

export interface TypewriterState {
  /** The revealed part of the text. */
  visible: string;
  /** The not-yet-revealed rest (render it invisibly to keep line breaks stable). */
  hidden: string;
  /** Revealed characters (code points). */
  count: number;
  total: number;
  done: boolean;
  /** Reveal everything now (a click while typing). */
  complete: () => void;
}

const TICK_MS = 16;
const SILENT_CHAR = /[\s\p{P}]/u;

/**
 * Visual-novel typewriter. Counts code points (never splits surrogate pairs), restarts whenever
 * `text` changes, and is driven by wall-clock time so a slow frame never slows the text down.
 */
export function useTypewriter(text: string, { cps, paused = false, instant = false, onBlip, blipEvery = 3 }: TypewriterOptions): TypewriterState {
  const chars = useMemo(() => Array.from(text), [text]);
  const total = chars.length;
  const [progress, setProgress] = useState<{ text: string; count: number }>({ text, count: 0 });
  const showAll = instant || cps <= 0;
  // Derived reset: a new text starts from zero on the very first render (no flash of the old text).
  const raw = progress.text === text ? progress.count : 0;
  const count = showAll && !paused ? total : raw;

  const countRef = useRef(count);
  countRef.current = count;
  const blipRef = useRef(onBlip);
  blipRef.current = onBlip;

  useEffect(() => {
    if (paused || showAll || total === 0) return;
    const base = countRef.current;
    if (base >= total) return;
    const startedAt = Date.now();
    let lastBlipAt = base;
    const id = setInterval(() => {
      const n = Math.min(total, base + Math.floor(((Date.now() - startedAt) * cps) / 1000));
      if (n <= countRef.current) {
        // Nothing new — or complete() already revealed everything.
        if (countRef.current >= total) clearInterval(id);
        return;
      }
      // Blip on newly revealed visible characters.
      if (blipRef.current) {
        let visibleSince = 0;
        for (let i = lastBlipAt; i < n; i++) if (!SILENT_CHAR.test(chars[i])) visibleSince++;
        if (visibleSince >= blipEvery) {
          blipRef.current();
          lastBlipAt = n;
        }
      }
      countRef.current = n;
      setProgress({ text, count: n });
      if (n >= total) clearInterval(id);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [text, chars, total, cps, paused, showAll, blipEvery]);

  const complete = useCallback(() => {
    countRef.current = total;
    setProgress({ text, count: total });
  }, [text, total]);

  return {
    visible: chars.slice(0, count).join(''),
    hidden: chars.slice(count).join(''),
    count,
    total,
    done: count >= total,
    complete,
  };
}
