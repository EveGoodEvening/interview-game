/**
 * App shell: stage scaling, screen routing with fade-through-black transitions, global startup
 * tasks (relay detection, audio unlock + volumes, document language) and the toast host.
 * OWNER: ui-shell agent.
 *
 * Only the title screen ships in the entry chunk; every other screen is code-split. A transition
 * starts loading the target screen's chunk while the curtain fades out and swaps once both are
 * done, so the fade never reveals a half-loaded stage (a Suspense fallback covers slow networks).
 * After the title's first paint the remaining screens are prefetched in the background. A chunk that
 * failed to load (even a background prefetch) is fetched again on the next visit or on the error
 * panel's Retry — see components/ui/chunkLoader.ts — so a network blip does not need a page reload
 * (only a failed shared dependency does; the error panel then asks for one).
 */
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { setAudioVolumes, unlockAudio } from './audio';
import { chunk, createChunkCache, watchStylesheetErrors } from './components/ui/chunkLoader';
import { ScreenErrorBoundary, ScreenFallback } from './components/ui/ScreenLoader';
import { StageFrame } from './components/ui/StageFrame';
import { ToastHost } from './components/ui/Toast';
import { detectProxy } from './llm/http';
import { TitleScreen } from './screens/TitleScreen';
import { preloadInterviewerAI, useGameStore } from './store/game';
import { useSettingsStore } from './store/settings';
import type { ScreenId } from './types';
import './App.css';

/** Fade to black, swap the screen, fade back in (total ≈ 300 ms). */
const FADE_OUT_MS = 140;
const FADE_IN_MS = 180;
/** Longest the curtain waits for a screen's chunk before handing over to the Suspense fallback. */
const MAX_CHUNK_WAIT_MS = 2500;
/** Background prefetch of the other screens starts this long after the first paint. */
const PREFETCH_DELAY_MS = 1200;

interface ScreenProps {
  from: ScreenId | null;
}

type LazyScreenId = Exclude<ScreenId, 'title'>;

// A chunk's CSS that fails to load is never requested again by Vite's preload helper: remember it.
watchStylesheetErrors();

/** Chunk loaders (the dynamic imports are what Vite/Rolldown split on). */
const SCREENS = createChunkCache<LazyScreenId, ComponentType<ScreenProps>>({
  setup: chunk(() => import('./screens/SetupScreen'), (m) => m.SetupScreen),
  interview: chunk(() => import('./screens/InterviewScreen'), (m) => m.InterviewScreen),
  result: chunk(() => import('./screens/ResultScreen'), (m) => m.ResultScreen),
  settings: chunk(() => import('./screens/SettingsScreen'), (m) => m.SettingsScreen),
  gallery: chunk(() => import('./screens/GalleryScreen'), (m) => m.GalleryScreen),
  records: chunk(() => import('./screens/RecordsScreen'), (m) => m.RecordsScreen),
  artPreview: chunk(() => import('./art/ArtPreviewScreen'), (m) => m.ArtPreviewScreen),
});

/** Most-likely-next first; the art QA sheet is never prefetched. */
const PREFETCH_ORDER: readonly LazyScreenId[] = ['setup', 'interview', 'result', 'settings', 'records', 'gallery'];

/**
 * Resolves once the screen's code is available (or failed — the boundary shows the error).
 * `fresh`: a new visit retries a load that failed earlier (e.g. a background prefetch on a flaky network).
 */
function preloadScreen(id: ScreenId, fresh = false): Promise<void> {
  if (id === 'title') return Promise.resolve();
  return SCREENS.load(id, { fresh }).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * A fresh lazy component per mounted screen: React.lazy keeps a rejected load forever, so reusing one
 * would make a failed chunk fail again on every later visit. Loaded screens render directly (no
 * suspending, not even for a tick).
 */
function screenComponent(id: LazyScreenId): ComponentType<ScreenProps> {
  return SCREENS.get(id) ?? lazy(() => SCREENS.load(id).then((c) => ({ default: c })));
}

function Screen({ id, from }: { id: ScreenId; from: ScreenId | null }) {
  // Chosen once per mounted screen (the wrapper is keyed by id), so it never switches type mid-life.
  const [Component] = useState<ComponentType<ScreenProps> | null>(() => (id === 'title' ? null : screenComponent(id)));
  if (id === 'title' || !Component) return <TitleScreen />;
  return <Component from={from} />;
}

interface Shown {
  id: ScreenId;
  /** The screen displayed before this one (lets Setup / Result tell where the player came from). */
  from: ScreenId | null;
}

type Fade = 'idle' | 'out' | 'in';

/** Keeps the displayed screen one fade (and one chunk load) behind the store's screen. */
function useScreenTransition(target: ScreenId, instant: boolean): { shown: Shown; fade: Fade } {
  const [shown, setShown] = useState<Shown>({ id: target, from: null });
  const [fade, setFade] = useState<Fade>('idle');

  useEffect(() => {
    if (target === shown.id) return;
    let cancelled = false;
    const timers: number[] = [];
    const wait = (ms: number) => new Promise<void>((resolve) => timers.push(window.setTimeout(resolve, ms)));
    const ready = Promise.race([preloadScreen(target, true), wait(MAX_CHUNK_WAIT_MS)]);
    if (!instant) setFade('out');
    void Promise.all([ready, instant ? null : wait(FADE_OUT_MS)]).then(() => {
      if (cancelled) return;
      setShown((prev) => ({ id: target, from: prev.id }));
      setFade(instant ? 'idle' : 'in');
    });
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [target, shown.id, instant]);

  useEffect(() => {
    if (fade !== 'in') return;
    const done = window.setTimeout(() => setFade('idle'), FADE_IN_MS);
    return () => window.clearTimeout(done);
  }, [fade]);

  return { shown, fade };
}

/** Events that grant user activation (Esc and touch-down do not), so unlocking never warns. */
const UNLOCK_EVENTS = ['mousedown', 'pointerup', 'touchend', 'keydown'] as const;

/**
 * `unlockSpeech` from the speech module, once its chunk has arrived. iOS/iPadOS only lets speech
 * (speechSynthesis / <audio>) start inside a user gesture, so it has to be called synchronously from
 * the gesture handler — the module is fetched at startup (it is not in the entry chunk) and any
 * gesture after that primes it; the call is idempotent.
 */
let unlockSpeechFn: (() => void) | null = null;
function loadSpeechUnlock(): void {
  if (unlockSpeechFn) return;
  import('./speech').then(
    (m) => {
      unlockSpeechFn = m.unlockSpeech;
    },
    () => {
      // Offline after an update: speech simply stays locked until a later gesture (e.g. a TTS preview).
    },
  );
}

export default function App() {
  const screen = useGameStore((s) => s.screen);
  const reduceMotion = useSettingsStore((s) => s.settings.display.reduceMotion);
  const uiLang = useSettingsStore((s) => s.settings.display.uiLang);
  const audio = useSettingsStore((s) => s.settings.audio);
  const { shown, fade } = useScreenTransition(screen, reduceMotion);

  useEffect(() => {
    if (import.meta.env.DEV) {
      // Handy for debugging and used by Playwright tests to inspect / seed state.
      (window as unknown as Record<string, unknown>).__stores = { game: useGameStore, settings: useSettingsStore };
      // E2E fast path: the demo interviewer's artificial "thinking" delay (the brain chunk is lazy).
      (window as unknown as Record<string, unknown>).__demo = {
        setDelay: (ms: number) => import('./ai').then((m) => m.setDemoDelay(ms)),
      };
    }
    let cancelled = false;
    detectProxy().then((ok) => {
      if (!cancelled) useSettingsStore.getState().setProxyAvailable(ok);
    });
    const requested = new URLSearchParams(window.location.search).get('screen');
    if (requested === 'artPreview') useGameStore.getState().navigate('artPreview');
    return () => {
      cancelled = true;
    };
  }, []);

  // Warm the other screens (and the interviewer brain) once the title is up, one at a time.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        for (const id of PREFETCH_ORDER) {
          if (cancelled) return;
          await preloadScreen(id);
        }
        if (!cancelled) await preloadInterviewerAI();
      })();
    }, PREFETCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // Browsers only allow audio after a user gesture: unlock music/SFX and speech on the first (and any
  // later) input; both unlocks are idempotent.
  useEffect(() => {
    loadSpeechUnlock();
    const unlock = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key === 'Escape') return;
      unlockAudio();
      unlockSpeechFn?.();
    };
    const opts = { capture: true, passive: true } as const;
    for (const type of UNLOCK_EVENTS) window.addEventListener(type, unlock, opts);
    return () => {
      for (const type of UNLOCK_EVENTS) window.removeEventListener(type, unlock, opts);
    };
  }, []);

  useEffect(() => {
    setAudioVolumes(audio);
  }, [audio]);

  useEffect(() => {
    document.documentElement.lang = uiLang === 'zh' ? 'zh-CN' : 'en';
    document.title = uiLang === 'zh' ? '面试物语 · Interview Story' : 'Interview Story · 面试物语';
  }, [uiLang]);

  return (
    <StageFrame reduceMotion={reduceMotion}>
      <div className="app-screen" key={shown.id} data-screen={shown.id}>
        <ScreenErrorBoundary onRetry={() => void preloadScreen(shown.id, true)}>
          <Suspense fallback={<ScreenFallback />}>
            <Screen id={shown.id} from={shown.from} />
          </Suspense>
        </ScreenErrorBoundary>
      </div>
      <div className={`app-fade app-fade--${fade}`} aria-hidden="true" data-testid="screen-fade" />
      <ToastHost />
    </StageFrame>
  );
}
