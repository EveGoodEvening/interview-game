import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../i18n';
import './StageFrame.css';

const W = 1280;
const H = 720;
/** Below this stage scale an upright phone makes the text unreadable (390×844 → 0.3). */
const PORTRAIT_MAX_SCALE = 0.5;

interface Viewport {
  width: number;
  height: number;
}

function readViewport(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** Stage scale that fits 1280×720 into the viewport. */
export function stageScale({ width, height }: Viewport): number {
  return Math.min(width / W, height / H);
}

/** An upright, narrow screen (a phone held in portrait): the 16:9 stage would be tiny. */
export function needsRotateHint(viewport: Viewport): boolean {
  return viewport.height > viewport.width && stageScale(viewport) < PORTRAIT_MAX_SCALE;
}

/** "Rotate your device" overlay above the (still running) stage; the player may dismiss it. */
function RotateHint({ onDismiss, still }: { onDismiss: () => void; still: boolean }) {
  const t = useT();
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => buttonRef.current?.focus(), []);
  return (
    <div
      className={`stage-rotate${still ? ' stage-rotate--still' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="stage-rotate-title"
      data-testid="rotate-hint"
      // Keys pressed here belong to the overlay, not to the screen underneath (e.g. the title menu).
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onDismiss();
      }}
    >
      <div className="stage-rotate__card">
        <svg className="stage-rotate__phone" viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">
          <g className="stage-rotate__device">
            <rect x="21" y="8" width="22" height="40" rx="4" />
            <path d="M29 43h6" />
          </g>
          <path className="stage-rotate__arrow" d="M50 30a18 18 0 0 1-12 22M38 52l6-1-2-6" />
        </svg>
        <p className="stage-rotate__title" id="stage-rotate-title">
          {t('common.rotate.title')}
        </p>
        <p className="stage-rotate__body">{t('common.rotate.body')}</p>
        <button ref={buttonRef} type="button" className="stage-rotate__dismiss" onClick={onDismiss} data-testid="rotate-dismiss">
          {t('common.rotate.dismiss')}
        </button>
      </div>
    </div>
  );
}

/**
 * Letterboxed 1280×720 stage scaled to fit the window, like a visual-novel engine. On an upright
 * phone a friendly overlay asks the player to turn the device (dismissable; landscape is unchanged).
 */
export function StageFrame({ children, reduceMotion }: { children: ReactNode; reduceMotion?: boolean }) {
  const [viewport, setViewport] = useState<Viewport>(readViewport);
  const [rotateDismissed, setRotateDismissed] = useState(false);
  useEffect(() => {
    const fit = () => setViewport(readViewport());
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
    };
  }, []);
  const scale = stageScale(viewport);
  const showRotate = !rotateDismissed && needsRotateHint(viewport);
  return (
    <div className="stage-viewport">
      <div
        className={`stage${reduceMotion ? ' reduce-motion' : ''}`}
        data-testid="stage"
        aria-hidden={showRotate || undefined}
        style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {children}
      </div>
      {showRotate && <RotateHint onDismiss={() => setRotateDismissed(true)} still={!!reduceMotion} />}
    </div>
  );
}
