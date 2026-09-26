/**
 * Global toast notifications.
 *
 *   import { toast } from '../components/ui/Toast';
 *   toast(t('common.saved'), { kind: 'success' });
 *
 * `<ToastHost />` is mounted once by App inside the stage (top-right, above modals).
 * The API works from anywhere (React or not); calls before the host mounts are queued.
 */
import { create } from 'zustand';
import { playSfx, type SfxName } from '../../audio';
import { Icon, type IconName } from './Icon';
import './Toast.css';

export type ToastKind = 'info' | 'success' | 'warning' | 'error' | 'unlock';

export interface ToastOptions {
  kind?: ToastKind;
  /** Bold first line above the message. */
  title?: string;
  /** Visible time in ms (default 3200; errors 5200). 0 = until dismissed. */
  durationMs?: number;
  /** Override the kind's icon. */
  icon?: IconName;
  /** Sound when shown (default: 'notify' for unlock toasts, silent otherwise). */
  sfx?: SfxName | null;
}

export interface ToastItem {
  id: number;
  message: string;
  title?: string;
  kind: ToastKind;
  icon: IconName;
  leaving: boolean;
}

interface ToastState {
  items: ToastItem[];
}

const MAX_VISIBLE = 4;
const LEAVE_MS = 260;
const KIND_ICON: Record<ToastKind, IconName> = {
  info: 'info',
  success: 'check',
  warning: 'warn',
  error: 'warn',
  unlock: 'trophy',
};

export const useToastStore = create<ToastState>(() => ({ items: [] }));

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function clearTimer(id: number) {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
}

function remove(id: number) {
  clearTimer(id);
  useToastStore.setState((s) => ({ items: s.items.filter((i) => i.id !== id) }));
}

/** Start the leave animation, then remove. Safe to call twice. */
export function dismissToast(id: number): void {
  const item = useToastStore.getState().items.find((i) => i.id === id);
  if (!item || item.leaving) return;
  clearTimer(id);
  useToastStore.setState((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, leaving: true } : i)) }));
  timers.set(
    id,
    setTimeout(() => remove(id), LEAVE_MS),
  );
}

/** Show a toast; returns its id. */
export function toast(message: string, opts: ToastOptions = {}): number {
  const kind = opts.kind ?? 'info';
  const id = nextId++;
  const item: ToastItem = { id, message, title: opts.title, kind, icon: opts.icon ?? KIND_ICON[kind], leaving: false };
  const current = useToastStore.getState().items.filter((i) => !i.leaving);
  // Drop the oldest visible toasts beyond the limit.
  for (const old of current.slice(0, Math.max(0, current.length - (MAX_VISIBLE - 1)))) dismissToast(old.id);
  useToastStore.setState((s) => ({ items: [...s.items, item] }));
  const duration = opts.durationMs ?? (kind === 'error' ? 5200 : kind === 'unlock' ? 4200 : 3200);
  if (duration > 0)
    timers.set(
      id,
      setTimeout(() => dismissToast(id), duration),
    );
  const sfx = opts.sfx === undefined ? (kind === 'unlock' ? 'notify' : null) : opts.sfx;
  if (sfx) playSfx(sfx);
  return id;
}

/** Remove every toast immediately (tests / screen resets). */
export function clearToasts(): void {
  for (const id of timers.keys()) clearTimer(id);
  useToastStore.setState({ items: [] });
}

/** Renders the toast stack. Mount once inside the stage. */
export function ToastHost() {
  const items = useToastStore((s) => s.items);
  return (
    <div className="gg-toasts" aria-live="polite" aria-relevant="additions">
      {items.map((item) => (
        <div
          key={item.id}
          className={`gg-toast gg-toast--${item.kind}${item.leaving ? ' gg-toast--leaving' : ''}`}
          role={item.kind === 'error' ? 'alert' : 'status'}
          onClick={() => dismissToast(item.id)}
          data-testid="toast"
        >
          <span className="gg-toast__icon">
            <Icon name={item.icon} size={16} />
          </span>
          <div className="gg-toast__body">
            {item.title && <div className="gg-toast__title">{item.title}</div>}
            <div className="gg-toast__msg">{item.message}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
