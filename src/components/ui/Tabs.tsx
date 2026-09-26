import { useRef, type KeyboardEvent } from 'react';
import { playSfx } from '../../audio';
import { Icon, type IconName } from './Icon';
import './Tabs.css';

export interface TabItem<V extends string = string> {
  id: V;
  label: string;
  icon?: IconName;
  /** Small secondary line (vertical tabs only), e.g. the English name. */
  sub?: string;
}

export interface TabsProps<V extends string = string> {
  items: readonly TabItem<V>[];
  value: V;
  onChange: (id: V) => void;
  orientation?: 'horizontal' | 'vertical';
  ariaLabel?: string;
  /** Prefix for tab/panel ids so panels can reference their tab (`${idPrefix}-tab-${id}`). */
  idPrefix?: string;
  className?: string;
}

/** Index of the next enabled tab when moving by `delta` with wrap-around. */
export function nextTabIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  return (((current + delta) % count) + count) % count;
}

/** WAI-ARIA tab list with roving focus (arrow keys / Home / End). */
export function Tabs<V extends string = string>({
  items,
  value,
  onChange,
  orientation = 'horizontal',
  ariaLabel,
  idPrefix = 'gg-tabs',
  className = '',
}: TabsProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(
    0,
    items.findIndex((i) => i.id === value),
  );

  const select = (index: number) => {
    const item = items[index];
    if (!item) return;
    if (item.id !== value) {
      playSfx('click');
      onChange(item.id);
    }
    refs.current[index]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const prev = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    let target = -1;
    if (e.key === prev) target = nextTabIndex(activeIndex, -1, items.length);
    else if (e.key === next) target = nextTabIndex(activeIndex, 1, items.length);
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = items.length - 1;
    if (target < 0) return;
    e.preventDefault();
    select(target);
  };

  return (
    <div
      className={`gg-tabs gg-tabs--${orientation} ${className}`}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      onKeyDown={onKeyDown}
    >
      {items.map((item, i) => {
        const active = i === activeIndex;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.id}`}
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${item.id}`}
            tabIndex={active ? 0 : -1}
            className={`gg-tabs__tab${active ? ' gg-tabs__tab--active' : ''}`}
            onClick={() => select(i)}
            onMouseEnter={() => !active && playSfx('hover')}
            data-testid={`tab-${item.id}`}
          >
            {item.icon && <Icon name={item.icon} size={orientation === 'vertical' ? 20 : 16} className="gg-tabs__icon" />}
            <span className="gg-tabs__text">
              <span className="gg-tabs__label">{item.label}</span>
              {item.sub && orientation === 'vertical' && <span className="gg-tabs__sub">{item.sub}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
