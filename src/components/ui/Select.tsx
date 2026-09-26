import { Icon } from './Icon';
import './Select.css';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
  /** Options sharing a group label are rendered inside one <optgroup>. */
  group?: string;
}

export interface SelectProps<V extends string = string> {
  value: V;
  options: readonly SelectOption<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  id?: string;
  className?: string;
  'data-testid'?: string;
}

type Block<V extends string> = { group: string | undefined; options: SelectOption<V>[] };

function toBlocks<V extends string>(options: readonly SelectOption<V>[]): Block<V>[] {
  const blocks: Block<V>[] = [];
  for (const opt of options) {
    const last = blocks[blocks.length - 1];
    if (last && last.group === opt.group) last.options.push(opt);
    else blocks.push({ group: opt.group, options: [opt] });
  }
  return blocks;
}

/** Styled native <select> (keeps the platform's accessible dropdown). */
export function Select<V extends string = string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
  id,
  className = '',
  'data-testid': testId,
}: SelectProps<V>) {
  const known = options.some((o) => o.value === value);
  const renderOption = (o: SelectOption<V>) => (
    <option key={o.value} value={o.value} disabled={o.disabled}>
      {o.label}
    </option>
  );
  return (
    <div className={`gg-select${disabled ? ' gg-select--disabled' : ''} ${className}`}>
      <select
        id={id}
        className="gg-select__native"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        data-testid={testId}
        onChange={(e) => onChange(e.currentTarget.value as V)}
      >
        {!known && <option value={value}>{value}</option>}
        {toBlocks(options).map((b, i) =>
          b.group ? (
            <optgroup key={`${b.group}-${i}`} label={b.group}>
              {b.options.map(renderOption)}
            </optgroup>
          ) : (
            b.options.map(renderOption)
          ),
        )}
      </select>
      <Icon name="chevronDown" size={16} className="gg-select__arrow" />
    </div>
  );
}
