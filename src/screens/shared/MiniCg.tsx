import type { CSSProperties } from 'react';
import { CharacterPortrait, EndingBackground } from '../../art';
import { CHARACTERS } from '../../characters';
import { Icon } from '../../components/ui/Icon';
import { useT } from '../../i18n';
import type { CharacterId, EndingId, Expression } from '../../types';
import './MiniCg.css';

export const ENDING_EXPRESSION: Record<EndingId, Expression> = {
  perfect: 'happy',
  offer: 'happy',
  pending: 'thinking',
  rejected: 'troubled',
};

export interface MiniCgProps {
  characterId: CharacterId;
  ending: EndingId;
  /** Show a silhouette + "???" instead of the scene. */
  locked?: boolean;
  /** Portrait size in px (the frame is sized by CSS / the parent). */
  portraitSize?: number;
  showStamp?: boolean;
  /**
   * A still frame (default): no petals, twinkles, rain or blinking. Thumbnails are small and listed
   * by the dozen (30 records → 1,200+ running animations otherwise), so only the big CG animates.
   */
  still?: boolean;
  className?: string;
}

/** Small ending "CG": the ending's background, the interviewer's portrait and a stamp. */
export function MiniCg({
  characterId,
  ending,
  locked = false,
  portraitSize = 120,
  showStamp = true,
  still = true,
  className = '',
}: MiniCgProps) {
  const t = useT();
  const style = { '--cg-c': CHARACTERS[characterId].themeColor } as CSSProperties;
  if (locked) {
    return (
      <div className={`mcg mcg--locked${still ? ' mcg--still' : ''} ${className}`} style={style} aria-label={t('gallery.lockedLabel')}>
        <CharacterPortrait
          characterId={characterId}
          expression="neutral"
          size={portraitSize}
          silhouette
          still={still}
          className="mcg__portrait"
        />
        <span className="mcg__lock">
          <Icon name="lock" size={16} />
          {t('gallery.locked')}
        </span>
      </div>
    );
  }
  return (
    <div className={`mcg mcg--${ending}${still ? ' mcg--still' : ''} ${className}`} style={style}>
      <EndingBackground ending={ending} still={still} />
      <CharacterPortrait
        characterId={characterId}
        expression={ENDING_EXPRESSION[ending]}
        size={portraitSize}
        shape="rounded"
        still={still}
        className="mcg__portrait"
      />
      {showStamp && <span className={`mcg__stamp mcg__stamp--${ending}`}>{t(`common.ending.${ending}.stamp`)}</span>}
    </div>
  );
}
