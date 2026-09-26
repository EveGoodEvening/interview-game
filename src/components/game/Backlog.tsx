import { useEffect, useRef, type CSSProperties } from 'react';
import { playSfx } from '../../audio';
import { useT } from '../../i18n';
import type { TranscriptEntry } from '../../types';
import { useReturnFocus } from './useReturnFocus';
import './Backlog.css';

export interface BacklogLine {
  id: string;
  role: TranscriptEntry['role'];
  text: string;
  skipped?: boolean;
  /** Tag such as "追问" shown next to interviewer lines. */
  tag?: string | null;
}

export interface BacklogProps {
  lines: readonly BacklogLine[];
  interviewer: { name: string; color: string };
  playerName: string;
  onReplay: (text: string) => void;
  /** Disable ▶ (e.g. while the mic is recording: the interviewer's voice would end up in the answer). */
  replayDisabled?: boolean;
  onClose: () => void;
}

/**
 * Scrollable conversation log (L / mouse wheel up). ▶ replays an interviewer line. The scene is
 * paused while it is open; the focus moves into the log (Tab / arrow keys stay inside it) and
 * returns to where it was on close.
 */
export function Backlog({ lines, interviewer, playerName, onReplay, replayDisabled = false, onClose }: BacklogProps) {
  const t = useT();
  const listRef = useRef<HTMLOListElement>(null);
  useReturnFocus();

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    el.focus({ preventScroll: true });
  }, []);

  return (
    <div
      className="blog"
      role="dialog"
      aria-modal="true"
      aria-label={t('interview.backlog.title')}
      data-testid="backlog"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
      style={{ '--blog-accent': interviewer.color } as CSSProperties}
    >
      <div className="blog__panel">
        <header className="blog__head">
          <span className="blog__kicker">BACKLOG</span>
          <h2 className="blog__title">{t('interview.backlog.title')}</h2>
          <span className="blog__hint">{t('interview.backlog.hint')}</span>
          <button type="button" className="blog__close" onClick={onClose} aria-label={t('interview.backlog.close')}>
            ×
          </button>
        </header>
        <ol className="blog__list gg-scroll" ref={listRef} tabIndex={-1}>
          {lines.length === 0 && <li className="blog__empty">{t('interview.backlog.empty')}</li>}
          {lines.map((line) => {
            const mine = line.role === 'candidate';
            return (
              <li key={line.id} className={`blog__line${mine ? ' blog__line--me' : ''}`}>
                <span className="blog__name">
                  {mine ? playerName : interviewer.name}
                  {line.tag && <em className="blog__tag">{line.tag}</em>}
                </span>
                <p className={`blog__text${line.skipped ? ' is-skipped' : ''}`}>{line.skipped ? t('interview.backlog.skipped') : line.text}</p>
                {!mine && (
                  <button
                    type="button"
                    className="blog__replay"
                    title={t('interview.backlog.replay')}
                    aria-label={t('interview.backlog.replay')}
                    disabled={replayDisabled}
                    onClick={() => {
                      if (replayDisabled) return;
                      playSfx('click');
                      onReplay(line.text);
                    }}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M4 2.5v11l9-5.5z" />
                    </svg>
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
