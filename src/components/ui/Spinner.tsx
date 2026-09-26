import './Spinner.css';

export interface SpinnerProps {
  size?: number;
  className?: string;
  /** Accessible label; decorative when omitted. */
  label?: string;
}

/** Small rotating sakura-petal ring. */
export function Spinner({ size = 18, className = '', label }: SpinnerProps) {
  return (
    <span
      className={`gg-spinner ${className}`}
      style={{ width: size, height: size }}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className="gg-spinner__dot" style={{ transform: `rotate(${i * 60}deg)`, animationDelay: `${i * 0.1}s` }} />
      ))}
    </span>
  );
}
