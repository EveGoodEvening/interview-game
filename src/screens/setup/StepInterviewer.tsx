import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { CharacterPortrait, CharacterSprite } from '../../art';
import { playSfx } from '../../audio';
import { CHARACTERS } from '../../characters';
import { Chip } from '../../components/ui/Chip';
import { Icon } from '../../components/ui/Icon';
import { Stars } from '../../components/ui/Stars';
import { useT, useUiLang } from '../../i18n';
import { CHARACTER_IDS, type CharacterId } from '../../types';
import { useSetupStore } from './draft';
import './StepInterviewer.css';

function CharacterCard({ id, selected, onPick }: { id: CharacterId; selected: boolean; onPick: (id: CharacterId) => void }) {
  const t = useT();
  const lang = useUiLang();
  const [hover, setHover] = useState(false);
  const c = CHARACTERS[id];
  const style = { '--char-c': c.themeColor } as CSSProperties;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`su-card${selected ? ' su-card--selected' : ''}`}
      style={style}
      onClick={() => onPick(id)}
      onMouseEnter={() => {
        setHover(true);
        playSfx('hover');
      }}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      data-testid={`char-card-${id}`}
    >
      <span className="su-card__band" aria-hidden="true" />
      {selected && (
        <span className="su-card__badge">
          <Icon name="check" size={13} strokeWidth={3} />
          {t('setup.char.selected')}
        </span>
      )}
      <CharacterPortrait characterId={id} expression={hover || selected ? 'smile' : 'neutral'} size={128} className="su-card__portrait" />
      <span className="su-card__name">{c.name[lang]}</span>
      <span className="su-card__role">{t('common.characterAt', { title: c.title[lang], company: c.company[lang] })}</span>
      <span className="su-card__tagline">{c.tagline[lang]}</span>
      <span className="su-card__quote">{t(`setup.char.quote.${id}`)}</span>
      <span className="su-card__meta">
        <Chip color={c.themeColor} size="sm">
          {t(`common.style.${c.defaultStyle}`)}
        </Chip>
        <span className="su-card__strict">
          <span>{t('common.strictness')}</span>
          <Stars value={c.strictness} size={13} label={`${t('common.strictness')} ${c.strictness}/5`} />
        </span>
      </span>
    </button>
  );
}

/** Step 1 — choose the interviewer. */
export function StepInterviewer() {
  const t = useT();
  const lang = useUiLang();
  const characterId = useSetupStore((s) => s.characterId);
  const setCharacter = useSetupStore((s) => s.setCharacter);
  const c = CHARACTERS[characterId];

  const pick = (id: CharacterId) => {
    if (id !== characterId) playSfx('confirm');
    setCharacter(id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const i = CHARACTER_IDS.indexOf(characterId);
    const next = CHARACTER_IDS[(i + delta + CHARACTER_IDS.length) % CHARACTER_IDS.length];
    pick(next);
    (e.currentTarget.querySelector(`[data-testid="char-card-${next}"]`) as HTMLElement | null)?.focus();
  };

  return (
    <div className="su-inter">
      <div className="su-inter__left">
        <div className="su-heading">
          <h2 className="su-heading__title">{t('setup.char.heading')}</h2>
          <p className="su-heading__sub">{t('setup.char.sub')}</p>
        </div>
        <div className="su-inter__cards" role="radiogroup" aria-label={t('setup.step.0')} onKeyDown={onKeyDown}>
          {CHARACTER_IDS.map((id) => (
            <CharacterCard key={id} id={id} selected={id === characterId} onPick={pick} />
          ))}
        </div>
      </div>

      <div className="su-inter__show" style={{ '--char-c': c.themeColor } as CSSProperties}>
        <div className="su-inter__glow" aria-hidden="true" />
        <div className="su-inter__sprite" key={characterId}>
          <CharacterSprite characterId={characterId} expression="smile" height={640} />
        </div>
        <div className="su-inter__profile" key={`p-${characterId}`}>
          <div className="su-inter__plate">
            <span className="su-inter__plate-name">{c.name[lang]}</span>
            <span className="su-inter__plate-title">{c.title[lang]}</span>
          </div>
          <div className="su-inter__company">
            <Icon name="home" size={14} />
            {c.company[lang]}
          </div>
          <p className="su-inter__bio">{c.bio[lang]}</p>
        </div>
      </div>
    </div>
  );
}
