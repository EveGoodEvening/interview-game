import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CharacterSprite, SakuraPetals, TitleBackground } from '../art';
import { playBgm, playSfx } from '../audio';
import { Icon } from '../components/ui/Icon';
import { toast } from '../components/ui/Toast';
import { useT } from '../i18n';
import { useGameStore } from '../store/game';
import { useSettingsStore } from '../store/settings';
import { LangSwitch } from './shared/LangSwitch';
import './TitleScreen.css';

export const APP_VERSION = '0.1.0';

type MenuId = 'new' | 'continue' | 'records' | 'gallery' | 'config';
const MENU: readonly MenuId[] = ['new', 'continue', 'records', 'gallery', 'config'];

/** Next enabled index when moving by `delta` (wraps around, skips disabled items). */
export function stepMenu(current: number, delta: 1 | -1, enabled: readonly boolean[]): number {
  const n = enabled.length;
  let i = current;
  for (let k = 0; k < n; k++) {
    i = (((i + delta) % n) + n) % n;
    if (enabled[i]) return i;
  }
  return current;
}

function Logo() {
  return (
    <div className="ts-logo">
      <div className="ts-logo__float">
        <Icon name="sakura" size={46} className="ts-logo__flower ts-logo__flower--a" />
        <Icon name="sakura" size={26} className="ts-logo__flower ts-logo__flower--b" />
        <h1 className="ts-logo__main">
          <span className="ts-logo__layer ts-logo__layer--rim" aria-hidden="true">
            面试物语
          </span>
          <span className="ts-logo__layer ts-logo__layer--outline" aria-hidden="true">
            面试物语
          </span>
          <span className="ts-logo__fill">面试物语</span>
        </h1>
        <div className="ts-logo__sub" data-text="Interview Story">
          Interview Story
        </div>
        <div className="ts-logo__ribbon">
          <span>~ Offer Get! ~</span>
        </div>
      </div>
    </div>
  );
}

export function TitleScreen() {
  const t = useT();
  const reduceMotion = useSettingsStore((s) => s.settings.display.reduceMotion);
  const [canContinue] = useState(() => useGameStore.getState().hasAutosave());
  const [busy, setBusy] = useState(false);
  const enabled = useMemo(() => MENU.map((id) => id !== 'continue' || canContinue), [canContinue]);
  const [selected, setSelected] = useState(() => (canContinue ? 1 : 0));
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    playBgm('title');
  }, []);

  const activate = useCallback(
    (id: MenuId) => {
      if (busy) return;
      const game = useGameStore.getState();
      playSfx('confirm');
      switch (id) {
        case 'new':
          game.navigate('setup');
          break;
        case 'continue':
          setBusy(true);
          game.resumeAutosave().then(
            () => setBusy(false),
            (err: unknown) => {
              setBusy(false);
              toast(t('title.continueFailed', { msg: err instanceof Error ? err.message : String(err) }), { kind: 'error' });
            },
          );
          break;
        case 'records':
          game.navigate('records');
          break;
        case 'gallery':
          game.navigate('gallery');
          break;
        case 'config':
          game.openSettings();
          break;
      }
    },
    [busy, t],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const up = e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W';
      const down = e.key === 'ArrowDown' || e.key === 's' || e.key === 'S';
      if (up || down) {
        e.preventDefault();
        const next = stepMenu(selected, up ? -1 : 1, enabled);
        if (next !== selected) playSfx('hover');
        setSelected(next);
        itemRefs.current[next]?.focus({ preventScroll: true });
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        // A focused control (menu button, language toggle) activates itself natively.
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement || active instanceof HTMLInputElement) return;
        e.preventDefault();
        const id = MENU[selected];
        if (id && enabled[selected]) activate(id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activate, enabled, selected]);

  return (
    <div className="ts" data-testid="screen-TitleScreen">
      <TitleBackground />
      <div className="ts__cast" aria-hidden="true">
        <div className="ts__char ts__char--ethan">
          <CharacterSprite characterId="ethan" expression="neutral" height={600} />
        </div>
        <div className="ts__char ts__char--haru">
          <CharacterSprite characterId="haru" expression="happy" height={570} />
        </div>
        <div className="ts__depth" />
        <div className="ts__char ts__char--yuki">
          <CharacterSprite characterId="yuki" expression="smile" height={660} />
        </div>
      </div>
      <div className="ts__haze" aria-hidden="true" />
      <div className="ts__petals" aria-hidden="true">
        <SakuraPetals count={26} reduceMotion={reduceMotion} />
      </div>

      <div className="ts__lang">
        <Icon name="globe" size={16} className="ts__lang-icon" />
        <LangSwitch />
      </div>

      <Logo />
      <p className="ts__tagline">{t('title.tagline')}</p>

      <nav className="ts-menu" aria-label={t('title.menuLabel')}>
        {MENU.map((id, i) => {
          const disabled = !enabled[i] || (busy && id === 'continue');
          return (
            <button
              key={id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              className={`ts-menu__item${i === selected ? ' ts-menu__item--selected' : ''}`}
              style={{ animationDelay: `${0.45 + i * 0.07}s` }}
              disabled={!enabled[i]}
              aria-disabled={disabled || undefined}
              title={!enabled[i] ? t('title.menu.continue.none') : undefined}
              onMouseEnter={() => {
                if (!enabled[i] || i === selected) return;
                playSfx('hover');
                setSelected(i);
              }}
              onFocus={() => setSelected(i)}
              onClick={() => activate(id)}
              data-testid={`title-${id}`}
            >
              <Icon name="sakura" size={18} className="ts-menu__bullet" />
              <span className="ts-menu__label">{t(`title.menu.${id}`)}</span>
              <span className="ts-menu__en">{t(`title.menu.${id}.en`)}</span>
            </button>
          );
        })}
      </nav>

      <footer className="ts__foot">
        <span className="ts__version">{t('title.version', { v: APP_VERSION })}</span>
        <span className="ts__keys">{t('title.keysHint')}</span>
        <span className="ts__credits">{t('title.credits')}</span>
      </footer>
    </div>
  );
}
