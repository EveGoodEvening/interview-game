import { playSfx } from '../../audio';
import { useT } from '../../i18n';
import './QuickMenu.css';

export type QuickAction = 'auto' | 'log' | 'replay' | 'skip' | 'config' | 'title';

export interface QuickMenuProps {
  auto: boolean;
  onAction: (action: QuickAction) => void;
  disabled?: Partial<Record<QuickAction, boolean>>;
}

const ITEMS: { action: QuickAction; key?: string }[] = [
  { action: 'auto', key: 'A' },
  { action: 'log', key: 'L' },
  { action: 'replay' },
  { action: 'skip' },
  { action: 'config' },
  { action: 'title' },
];

/** Classic VN quick-menu row under the text box. Buttons never take focus (Space keeps advancing). */
export function QuickMenu({ auto, onAction, disabled = {} }: QuickMenuProps) {
  const t = useT();
  return (
    <nav className="qmenu" aria-label={t('interview.quick.aria')} onClick={(e) => e.stopPropagation()}>
      {ITEMS.map(({ action, key }) => (
        <button
          key={action}
          type="button"
          className={`qmenu__btn${action === 'auto' && auto ? ' is-on' : ''}`}
          disabled={disabled[action]}
          aria-pressed={action === 'auto' ? auto : undefined}
          title={t(`interview.quick.${action}Tip`) + (key ? ` (${key})` : '')}
          data-testid={`quick-${action}`}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => !disabled[action] && playSfx('hover')}
          onClick={() => {
            playSfx('click');
            onAction(action);
          }}
        >
          {t(`interview.quick.${action}`)}
        </button>
      ))}
    </nav>
  );
}
