/**
 * Pieces for lazily loaded screens: a stage-sized Suspense fallback that continues the black
 * transition curtain (so a slow chunk never flashes a blank stage), and an error boundary for a
 * screen that failed to load or render. A failed chunk (offline, or a deploy replaced it) can be
 * retried in place once the network is back — unless the browser can only load it after a reload,
 * then Reload is the main action. Title and Reload are always offered.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { translate, useT } from '../../i18n';
import { useGameStore } from '../../store/game';
import { getSettings } from '../../store/settings';
import { Button } from './Button';
import { isChunkLoadError, isReloadRequired } from './chunkLoader';
import { Spinner } from './Spinner';
import './ScreenLoader.css';

/** Full-stage "Loading…" shown while a screen's code is being fetched. */
export function ScreenFallback() {
  const t = useT();
  return (
    <div className="gg-screen-loading" data-testid="screen-loading">
      <span className="gg-screen-loading__badge">
        <Spinner size={22} />
        <span>{t('common.loading')}</span>
      </span>
    </div>
  );
}

interface BoundaryProps {
  children: ReactNode;
  /**
   * Called when the player presses Retry after a chunk failed to load, before the screen mounts
   * again (the app shell starts a fresh load there).
   */
  onRetry?: () => void;
}

/** Leave a broken screen for the title; an interview is suspended so Continue picks it up again. */
function backToTitle(): void {
  const game = useGameStore.getState();
  if (game.screen === 'interview') game.suspendInterview();
  else game.navigate('title');
}

interface BoundaryState {
  error: Error | null;
}

/** Catches screen render / chunk-load failures so the whole stage never goes blank. */
export class ScreenErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[app] screen failed to render', error, info.componentStack);
  }

  private retry = () => {
    this.props.onRetry?.();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const lang = getSettings().display.uiLang;
    const chunk = isChunkLoadError(error);
    // Retry helps unless the chunk is reachable again but this document can no longer import it.
    const canRetry = chunk && !isReloadRequired(error);
    const title = chunk ? 'common.screenError' : 'common.screenCrash';
    const hint = !chunk ? null : canRetry ? 'common.screenErrorHint' : 'common.screenErrorReload';
    return (
      <div className="gg-screen-loading gg-screen-loading--error" role="alert" data-testid="screen-error">
        <div className="gg-screen-loading__panel gg-panel">
          <p className="gg-screen-loading__title">{translate(lang, title)}</p>
          {hint && <p className="gg-screen-loading__hint">{translate(lang, hint)}</p>}
          <p className="gg-screen-loading__detail">{error.message}</p>
          <div className="gg-screen-loading__actions">
            <Button onClick={backToTitle} data-testid="screen-error-title">
              {translate(lang, 'common.backToTitle')}
            </Button>
            {canRetry && (
              <Button variant="primary" icon="refresh" onClick={this.retry} data-testid="screen-error-retry">
                {translate(lang, 'common.retry')}
              </Button>
            )}
            <Button
              variant={canRetry ? 'secondary' : 'primary'}
              icon={canRetry ? undefined : 'refresh'}
              onClick={() => window.location.reload()}
              data-testid="screen-error-reload"
            >
              {translate(lang, 'common.reload')}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
