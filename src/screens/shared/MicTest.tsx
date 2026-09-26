import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Hint } from '../../components/ui/Hint';
import { LevelMeter } from '../../components/ui/LevelMeter';
import { useT } from '../../i18n';
import { SttError, testMicrophone, type SttErrorCode } from '../../speech';
import './MicTest.css';

type MicState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'done'; peak: number } | { kind: 'error'; code: SttErrorCode };

const TEST_MS = 2800;
/** Peak level above which we call the mic "working". */
export const MIC_OK_PEAK = 0.06;

/** "Test mic" button with a live level meter and a localized verdict. */
export function MicTest({ compact = false, 'data-testid': testId = 'mic-test' }: { compact?: boolean; 'data-testid'?: string }) {
  const t = useT();
  const [state, setState] = useState<MicState>({ kind: 'idle' });
  const [level, setLevel] = useState(0);
  const mounted = useRef(true);
  const frame = useRef(0);
  const latest = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelAnimationFrame(frame.current);
    };
  }, []);

  const run = () => {
    setState({ kind: 'testing' });
    setLevel(0);
    // Coalesce level callbacks into one React update per animation frame.
    const onLevel = (l: number) => {
      latest.current = l;
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (mounted.current) setLevel(latest.current);
      });
    };
    testMicrophone(TEST_MS, onLevel).then(
      (peak) => {
        if (!mounted.current) return;
        setLevel(0);
        setState({ kind: 'done', peak });
      },
      (err: unknown) => {
        if (!mounted.current) return;
        setLevel(0);
        setState({ kind: 'error', code: err instanceof SttError ? err.code : 'not-supported' });
      },
    );
  };

  const testing = state.kind === 'testing';
  return (
    <div className={`mic-test${compact ? ' mic-test--compact' : ''}`}>
      <div className="mic-test__row">
        <Button size="sm" icon="mic" loading={testing} onClick={run} data-testid={testId}>
          {testing ? t('common.mic.testing') : t('common.mic.test')}
        </Button>
        <LevelMeter level={level} active={testing} bars={compact ? 14 : 20} className="mic-test__meter" />
      </div>
      {state.kind === 'done' &&
        (state.peak >= MIC_OK_PEAK ? (
          <Hint kind="success" compact>
            {t('common.mic.ok')}
          </Hint>
        ) : (
          <Hint kind="warn" compact>
            {t('common.mic.quiet')}
          </Hint>
        ))}
      {state.kind === 'error' && (
        <Hint kind="error" compact>
          {t(`common.sttError.${state.code}`)}
        </Hint>
      )}
    </div>
  );
}
