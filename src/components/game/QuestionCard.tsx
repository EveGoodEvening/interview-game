import type { CSSProperties } from 'react';
import { useT } from '../../i18n';
import './QuestionCard.css';

export interface QuestionCardProps {
  question: string;
  accent: string;
  collapsed: boolean;
  onToggle: () => void;
  /** Small caption, e.g. "Q2 · 追问". */
  caption?: string;
}

/** The current question pinned at the top while the candidate answers. Collapsible. */
export function QuestionCard({ question, accent, collapsed, onToggle, caption }: QuestionCardProps) {
  const t = useT();
  return (
    <aside className={`qcard${collapsed ? ' qcard--collapsed' : ''}`} style={{ '--qcard-accent': accent } as CSSProperties} data-testid="question-card">
      <button
        type="button"
        className="qcard__head"
        onClick={onToggle}
        onMouseDown={(e) => e.preventDefault()}
        aria-expanded={!collapsed}
        title={collapsed ? t('interview.question.expand') : t('interview.question.collapse')}
      >
        <svg className="qcard__pin" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14.5 2.5 21.5 9.5 18.8 10.4 15.6 13.6 16 18 13.6 20.4 9.6 16.4 4.4 21.6 2.4 21.6 2.4 19.6 7.6 14.4 3.6 10.4 6 8 10.4 8.4 13.6 5.2Z" />
        </svg>
        <span className="qcard__label">{t('interview.question.label')}</span>
        {caption && <span className="qcard__caption">{caption}</span>}
        <span className="qcard__chev" aria-hidden="true" />
      </button>
      {!collapsed && <p className="qcard__text gg-scroll">{question}</p>}
    </aside>
  );
}
