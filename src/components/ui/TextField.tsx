import { forwardRef, useId, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useT } from '../../i18n';
import { Icon } from './Icon';
import './TextField.css';

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type' | 'size'>;

export interface TextFieldProps extends NativeInputProps {
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'url' | 'search' | 'email';
  /** Render as a password field with a show/hide (eye) toggle. */
  secret?: boolean;
  /** Monospace text (URLs, keys, model ids). */
  mono?: boolean;
  invalid?: boolean;
  /** Suggestions shown as a datalist (combobox). */
  suggestions?: readonly string[];
}

/** Single-line input. With `suggestions` it becomes a free-text combobox (datalist). */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { value, onChange, type = 'text', secret = false, mono = false, invalid = false, suggestions, className = '', id, ...rest },
  ref,
) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const autoId = useId();
  const listId = suggestions && suggestions.length > 0 ? `${id ?? autoId}-list` : undefined;
  const inputType = secret ? (revealed ? 'text' : 'password') : type;
  return (
    <div
      className={`gg-field${mono ? ' gg-field--mono' : ''}${invalid ? ' gg-field--invalid' : ''}${secret ? ' gg-field--secret' : ''} ${className}`}
    >
      <input
        ref={ref}
        id={id}
        className="gg-field__input"
        type={inputType}
        value={value}
        list={listId}
        aria-invalid={invalid || undefined}
        spellCheck={mono || secret ? false : undefined}
        autoComplete={secret ? 'off' : rest.autoComplete}
        onChange={(e) => onChange(e.currentTarget.value)}
        {...rest}
      />
      {secret && (
        <button
          type="button"
          className="gg-field__eye"
          aria-label={revealed ? t('common.hideSecret') : t('common.showSecret')}
          aria-pressed={revealed}
          title={revealed ? t('common.hideSecret') : t('common.showSecret')}
          onClick={() => setRevealed((r) => !r)}
        >
          <Icon name={revealed ? 'eyeOff' : 'eye'} size={18} />
        </button>
      )}
      {listId && (
        <datalist id={listId}>
          {[...new Set(suggestions)].map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
});

type NativeTextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'>;

export interface TextAreaProps extends NativeTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { value, onChange, invalid = false, className = '', ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={`gg-textarea gg-scroll${invalid ? ' gg-textarea--invalid' : ''} ${className}`}
      value={value}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.currentTarget.value)}
      {...rest}
    />
  );
});
