import { useEffect, useMemo, useRef, useState } from 'react';
import { playBgm, playSfx } from '../audio';
import { Button } from '../components/ui/Button';
import { Hint } from '../components/ui/Hint';
import { MenuFrame } from '../components/ui/MenuFrame';
import { Stepper } from '../components/ui/Stepper';
import { toast } from '../components/ui/Toast';
import { useT, useUiLang } from '../i18n';
import { fullConfigFor, useGameStore } from '../store/game';
import type { ScreenId } from '../types';
import { useSetupStore } from './setup/draft';
import {
  buildConfig,
  canLeaveStep,
  maxReachableStep,
  savePersistedSetup,
  SETUP_STEPS,
  stepErrors,
  validateDraft,
  type SetupStep,
} from './setup/model';
import { StepInterviewer } from './setup/StepInterviewer';
import { StepOptions } from './setup/StepOptions';
import { StepResume } from './setup/StepResume';
import './SetupScreen.css';

export { requestSetupPrefill } from './setup/draft';

export interface SetupScreenProps {
  /** Screen shown before Setup: 'settings' restores the wizard, 'result' prefills from the last record. */
  from?: ScreenId | null;
}

/** New interview wizard: interviewer → résumé → options & device check → start. */
export function SetupScreen({ from = null }: SetupScreenProps) {
  const t = useT();
  const uiLang = useUiLang();
  // Initialise the draft before the first render reads it (idempotent under StrictMode).
  useState(() => {
    const { lastRecord } = useGameStore.getState();
    const lastConfig = lastRecord ? fullConfigFor(lastRecord.id) : null;
    useSetupStore.getState().init({ from, lastRecord, lastConfig, uiLang });
    return true;
  });
  const step = useSetupStore((s) => s.step);
  const direction = useSetupStore((s) => s.direction);
  const resume = useSetupStore((s) => s.resume);
  const options = useSetupStore((s) => s.options);
  const [starting, setStarting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    playBgm('title');
    // Once the interview has started, the next visit begins at step 1 (choices are kept).
    return () => {
      if (started.current) useSetupStore.getState().finish();
    };
  }, []);

  const issues = useMemo(() => validateDraft({ resume, options }), [resume, options]);
  const errors = stepErrors(issues, step);
  const reachable = maxReachableStep(issues);
  const isLast = step === SETUP_STEPS[SETUP_STEPS.length - 1];

  const goTo = (target: SetupStep) => {
    setShowErrors(false);
    useSetupStore.getState().goTo(target);
  };

  const start = async () => {
    const draft = useSetupStore.getState();
    const config = buildConfig(draft);
    savePersistedSetup(draft);
    setStarting(true);
    started.current = true;
    try {
      await useGameStore.getState().startInterview(config);
    } catch (err) {
      started.current = false;
      setStarting(false);
      toast(t('setup.startFailed', { msg: err instanceof Error ? err.message : String(err) }), { kind: 'error' });
    }
  };

  // The Next / Start buttons are silent themselves: exactly one sound, depending on the outcome.
  const next = () => {
    if (!canLeaveStep(issues, step)) {
      setShowErrors(true);
      playSfx('cancel');
      return;
    }
    playSfx('confirm');
    if (isLast) void start();
    else goTo((step + 1) as SetupStep);
  };

  const prev = () => {
    if (step === 0) useGameStore.getState().navigate('title');
    else goTo((step - 1) as SetupStep);
  };

  // Ctrl+Enter = next / start from anywhere in the wizard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !starting) {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>('[data-testid="setup-next"]')?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [starting]);

  const steps = SETUP_STEPS.map((s) => ({ label: t(`setup.step.${s}`), caption: t('setup.stepCaption', { n: s + 1 }) }));

  return (
    <MenuFrame
      kicker={t('setup.kicker')}
      title={t('setup.title')}
      backLabel={t('common.backToTitle')}
      onBack={() => useGameStore.getState().navigate('title')}
      extra={
        <Stepper
          steps={steps}
          current={step}
          maxReachable={reachable}
          onStepClick={(i) => goTo(i as SetupStep)}
          ariaLabel={t('setup.stepperLabel')}
        />
      }
      className="su"
      petals={step === 0}
      data-testid="screen-SetupScreen"
    >
      <div className="su__stage">
        <div key={step} className={`su__step su__step--${direction > 0 ? 'fwd' : 'back'}`} data-step={step}>
          {step === 0 && <StepInterviewer />}
          {step === 1 && <StepResume />}
          {step === 2 && <StepOptions />}
        </div>
      </div>

      <footer className="su__foot">
        <Button
          variant="secondary"
          icon="back"
          sfx="cancel"
          onClick={prev}
          className={step === 0 ? 'su__prev--hidden' : ''}
          aria-hidden={step === 0 || undefined}
          tabIndex={step === 0 ? -1 : undefined}
          data-testid="setup-prev"
        >
          {t('setup.prev')}
        </Button>
        <div className="su__issues" aria-live="polite">
          {showErrors &&
            errors.map((e) => (
              <Hint key={e.code} kind="error" compact>
                {t(`setup.issue.${e.code}`)}
              </Hint>
            ))}
        </div>
        {isLast ? (
          <Button
            variant="primary"
            size="lg"
            icon="sakura"
            loading={starting}
            sfx={null}
            onClick={next}
            className="su__start"
            data-testid="setup-next"
          >
            {starting ? t('setup.starting') : t('setup.start')}
          </Button>
        ) : (
          <Button variant="primary" size="lg" iconEnd="next" sfx={null} onClick={next} data-testid="setup-next">
            {t('setup.next')}
          </Button>
        )}
      </footer>
    </MenuFrame>
  );
}
