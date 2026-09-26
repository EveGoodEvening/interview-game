import { useEffect, useRef, type ReactNode } from 'react';
import { LobbyBackground, SakuraPetals } from '../../art';
import { playSfx } from '../../audio';
import { useSettingsStore } from '../../store/settings';
import { Icon } from './Icon';
import './MenuFrame.css';

export interface MenuFrameProps {
  /** Big decorative English word behind the title, e.g. "CONFIG". */
  kicker: string;
  title: string;
  backLabel: string;
  onBack: () => void;
  /** Right side of the header. */
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Falling petals over the background (off for busy screens). */
  petals?: boolean;
  'data-testid'?: string;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Shared layout for menu screens (Setup, Config, Records, Gallery): lobby background,
 * a galgame-style header with a back button, and a content area. Esc = back.
 */
export function MenuFrame({
  kicker,
  title,
  backLabel,
  onBack,
  extra,
  children,
  className = '',
  petals = true,
  'data-testid': testId,
}: MenuFrameProps) {
  const reduceMotion = useSettingsStore((s) => s.settings.display.reduceMotion);
  const backRef = useRef(onBack);
  useEffect(() => {
    backRef.current = onBack;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isEditable(e.target)) return;
      e.preventDefault();
      playSfx('cancel');
      backRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`mf ${className}`} data-testid={testId}>
      <LobbyBackground />
      <div className="mf__veil" aria-hidden="true" />
      {petals && (
        <div className="mf__petals" aria-hidden="true">
          <SakuraPetals count={10} reduceMotion={reduceMotion} />
        </div>
      )}
      <header className="mf__head">
        <button
          type="button"
          className="mf__back"
          onClick={() => {
            playSfx('cancel');
            onBack();
          }}
          onMouseEnter={() => playSfx('hover')}
          data-testid="menu-back"
        >
          <Icon name="back" size={20} strokeWidth={2.6} />
          <span>{backLabel}</span>
        </button>
        <div className="mf__title">
          <span className="mf__kicker" aria-hidden="true">
            {kicker}
          </span>
          <h1 className="mf__main">
            <Icon name="sakura" size={22} className="mf__main-icon" />
            {title}
          </h1>
        </div>
        <div className="mf__extra">{extra}</div>
      </header>
      <main className="mf__body">{children}</main>
    </div>
  );
}
