import { useT, useUiLang } from '../../i18n';
import { chapterLabel, type ChapterInput } from './labels';
import './ChapterCard.css';

/** How long a chapter title card stays on screen (ms). The CSS animation matches it. */
export const CHAPTER_CARD_MS = 1700;

/** Full-width chapter title card ("第二幕 · 项目深挖"). Purely visual; the parent removes it after CHAPTER_CARD_MS. */
export function ChapterCard({ chapter }: { chapter: ChapterInput }) {
  const t = useT();
  const lang = useUiLang();
  const label = chapterLabel(chapter, t, lang);
  return (
    <div className="chapter" role="status" aria-label={label.full} data-testid="chapter-card">
      <div className="chapter__band">
        <span className="chapter__kicker">{label.kicker}</span>
        <div className="chapter__line">
          <span className="chapter__flower" aria-hidden="true">
            ✿
          </span>
          <span className="chapter__head">{label.head}</span>
          {label.title && (
            <>
              <span className="chapter__dot" aria-hidden="true">
                ·
              </span>
              <span className="chapter__title">{label.title}</span>
            </>
          )}
          <span className="chapter__flower" aria-hidden="true">
            ✿
          </span>
        </div>
      </div>
    </div>
  );
}
