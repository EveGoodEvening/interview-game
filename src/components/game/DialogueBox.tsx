import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import './DialogueBox.css';

export interface Speaker {
  name: string;
  /** Accent colour for the name plate (hex). */
  color: string;
  /** Small caption next to the name ("HR 经理 · 星辰科技"). */
  sub?: string;
}

export interface DialogueBoxProps {
  speaker: Speaker | null;
  /** Background opacity 0.3–1 (settings.display.boxOpacity). */
  opacity: number;
  /** 'player' switches the plate style and gives the body more room for the answer panel. */
  variant?: 'interviewer' | 'player';
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  children: ReactNode;
  className?: string;
  /** Announce text changes to screen readers. */
  live?: boolean;
}

/** Translucent visual-novel text box with a name plate, anchored to the bottom of the stage. */
export function DialogueBox({ speaker, opacity, variant = 'interviewer', onClick, children, className = '', live = false }: DialogueBoxProps) {
  const style = {
    '--dlg-alpha': Math.min(1, Math.max(0.3, opacity)),
    '--dlg-accent': speaker?.color ?? 'var(--c-sakura)',
  } as CSSProperties;
  return (
    <section className={`dlg-box dlg-box--${variant} ${className}`} style={style} onClick={onClick} aria-live={live ? 'polite' : undefined}>
      <div className="dlg-box__frame" aria-hidden="true" />
      {speaker && (
        <div className="dlg-box__plate">
          <span className="dlg-box__name">{speaker.name}</span>
          {speaker.sub && <span className="dlg-box__sub">{speaker.sub}</span>}
        </div>
      )}
      <div className="dlg-box__body">{children}</div>
    </section>
  );
}

export interface DialogueTextProps {
  visible: string;
  hidden: string;
  done: boolean;
  /** Show the blinking ▼ when the page is complete. */
  showNext?: boolean;
}

/**
 * Typewriter text. The unrevealed rest is rendered invisibly so words never jump between lines
 * while typing; the ▼ "next" marker follows the last character.
 */
export function DialogueText({ visible, hidden, done, showNext = true }: DialogueTextProps) {
  return (
    <p className="dlg-text">
      {/* Screen readers get the whole page once, not every typed character. */}
      <span className="gg-visually-hidden">{visible + hidden}</span>
      <span className="dlg-text__shown" aria-hidden="true">
        {visible}
      </span>
      {hidden && (
        <span className="dlg-text__ghost" aria-hidden="true">
          {hidden}
        </span>
      )}
      {done && showNext && <span className="dlg-text__next" aria-hidden="true" />}
    </p>
  );
}

/** "( … is thinking ··· )" loading line. */
export function DialogueLoading({ text }: { text: string }) {
  return (
    <p className="dlg-text dlg-text--loading" role="status">
      <span>{text}</span>
      <span className="dlg-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </p>
  );
}
