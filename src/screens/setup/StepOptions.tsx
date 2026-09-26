import { useState } from 'react';
import { CHARACTERS } from '../../characters';
import { Button } from '../../components/ui/Button';
import { FieldRow } from '../../components/ui/FieldRow';
import { Hint } from '../../components/ui/Hint';
import { Icon } from '../../components/ui/Icon';
import { Segmented } from '../../components/ui/Segmented';
import { Slider } from '../../components/ui/Slider';
import { TextArea, TextField } from '../../components/ui/TextField';
import { useT } from '../../i18n';
import type { Difficulty, InterviewStyle, Lang } from '../../types';
import { DeviceCheck } from './DeviceCheck';
import { useSetupStore } from './draft';
import {
  DIFFICULTIES,
  estimateMinutes,
  FOLLOW_UPS_RANGE,
  MAIN_QUESTIONS_RANGE,
  MAX_JD_CHARS,
  MAX_ROLE_CHARS,
  STYLES,
  TIME_LIMITS,
  validateDraft,
} from './model';
import './StepOptions.css';

/** Step 3 — interview options on the left, device check on the right. */
export function StepOptions() {
  const t = useT();
  const options = useSetupStore((s) => s.options);
  const resume = useSetupStore((s) => s.resume);
  const characterId = useSetupStore((s) => s.characterId);
  const prefilled = useSetupStore((s) => s.prefilled);
  const { setOptions, setLang } = useSetupStore.getState();
  const [jdOpen, setJdOpen] = useState(() => options.jobDescription.trim() !== '');
  const character = CHARACTERS[characterId];
  const errors = validateDraft({ resume, options }).filter((i) => i.step === 2 && i.level === 'error');
  const hasError = (code: string) => errors.some((e) => e.code === code);

  return (
    <div className="su-opts">
      <section className="su-opts__panel" aria-label={t('setup.opt.heading')}>
        <header className="su-opts__head">
          <Icon name="sliders" size={18} className="su-opts__icon" />
          <h2 className="su-opts__title">{t('setup.opt.heading')}</h2>
          <span className="su-opts__estimate">
            <Icon name="clock" size={14} />
            {t('setup.opt.estimate', { t: t('common.minutes', { n: estimateMinutes(options) }) })}
          </span>
        </header>
        {prefilled && (
          <Hint kind="tip" compact className="su-opts__prefilled">
            {t('setup.opt.prefilled')}
          </Hint>
        )}
        <div className="su-opts__rows gg-scroll">
          <FieldRow label={t('setup.opt.lang')} hint={t('setup.opt.langHint')} labelWidth={196}>
            {(id) => (
              <Segmented<Lang>
                ariaLabelledBy={id}
                value={options.lang}
                onChange={setLang}
                options={[
                  { value: 'zh', label: t('common.lang.zh') },
                  { value: 'en', label: t('common.lang.en') },
                ]}
                data-testid="opt-lang"
              />
            )}
          </FieldRow>

          <FieldRow
            label={t('setup.opt.role')}
            labelWidth={196}
            below={
              hasError('roleTooLong') ? (
                <Hint kind="error" compact>
                  {t('setup.issue.roleTooLong')}
                </Hint>
              ) : undefined
            }
          >
            {(id) => (
              <TextField
                aria-labelledby={id}
                value={options.targetRole}
                onChange={(targetRole) => setOptions({ targetRole })}
                placeholder={t('setup.opt.rolePlaceholder')}
                maxLength={MAX_ROLE_CHARS + 20}
                invalid={hasError('roleTooLong')}
                data-testid="opt-role"
              />
            )}
          </FieldRow>

          <FieldRow
            label={t('setup.opt.jd')}
            labelWidth={196}
            below={
              hasError('jdTooLong') ? (
                <Hint kind="error" compact>
                  {t('setup.issue.jdTooLong')}
                </Hint>
              ) : undefined
            }
          >
            {(id) => (
              <div className={`su-jd${jdOpen ? ' su-jd--open' : ''}`}>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={jdOpen ? 'minus' : 'plus'}
                  onClick={() => setJdOpen((o) => !o)}
                  aria-expanded={jdOpen}
                  data-testid="jd-toggle"
                >
                  {jdOpen ? t('setup.opt.jdHide') : t('setup.opt.jdAdd')}
                  {!jdOpen && options.jobDescription.trim() && ` · ${t('setup.opt.jdCount', { n: options.jobDescription.length })}`}
                </Button>
                {jdOpen && (
                  <div className="su-jd__box">
                    <TextArea
                      aria-labelledby={id}
                      rows={5}
                      value={options.jobDescription}
                      onChange={(jobDescription) => setOptions({ jobDescription })}
                      placeholder={t('setup.opt.jdPlaceholder')}
                      maxLength={MAX_JD_CHARS + 200}
                      invalid={hasError('jdTooLong')}
                      autoFocus={!options.jobDescription}
                      data-testid="opt-jd"
                    />
                    <span className="su-jd__count">{t('setup.opt.jdCount', { n: options.jobDescription.length })}</span>
                  </div>
                )}
              </div>
            )}
          </FieldRow>

          <FieldRow label={t('setup.opt.style')} labelWidth={196}>
            {(id) => (
              <div className="su-inline">
                <Segmented<InterviewStyle>
                  ariaLabelledBy={id}
                  value={options.style}
                  onChange={(style) => setOptions({ style, styleTouched: style !== character.defaultStyle })}
                  options={STYLES.map((s) => ({
                    value: s,
                    label: t(`common.style.${s}`),
                    badge: s === character.defaultStyle ? t('setup.opt.styleDefault') : undefined,
                    hint: t(`common.style.${s}.desc`),
                  }))}
                  data-testid="opt-style"
                />
                <span className="su-inline__note">{t(`common.style.${options.style}.desc`)}</span>
              </div>
            )}
          </FieldRow>

          <FieldRow label={t('setup.opt.difficulty')} labelWidth={196}>
            {(id) => (
              <div className="su-inline">
                <Segmented<Difficulty>
                  ariaLabelledBy={id}
                  value={options.difficulty}
                  onChange={(difficulty) => setOptions({ difficulty })}
                  options={DIFFICULTIES.map((d) => ({
                    value: d,
                    label: t(`common.difficulty.${d}`),
                    hint: t(`common.difficulty.${d}.desc`),
                  }))}
                  data-testid="opt-difficulty"
                />
                <span className="su-inline__note">{t(`common.difficulty.${options.difficulty}.desc`)}</span>
              </div>
            )}
          </FieldRow>

          <FieldRow label={t('setup.opt.questions')} labelWidth={196}>
            {(id) => (
              <Slider
                ariaLabelledBy={id}
                min={MAIN_QUESTIONS_RANGE.min}
                max={MAIN_QUESTIONS_RANGE.max}
                value={options.mainQuestions}
                onChange={(mainQuestions) => setOptions({ mainQuestions })}
                format={(n) => t('setup.opt.questionsValue', { n })}
                data-testid="opt-questions"
              />
            )}
          </FieldRow>

          <FieldRow label={t('setup.opt.followUps')} labelWidth={196}>
            {(id) => (
              <Segmented<number>
                ariaLabelledBy={id}
                value={options.maxFollowUps}
                onChange={(maxFollowUps) => setOptions({ maxFollowUps })}
                options={Array.from({ length: FOLLOW_UPS_RANGE.max - FOLLOW_UPS_RANGE.min + 1 }, (_, i) => ({
                  value: FOLLOW_UPS_RANGE.min + i,
                  label:
                    FOLLOW_UPS_RANGE.min + i === 0
                      ? t('setup.opt.followUpsNone')
                      : t('setup.opt.followUpsValue', { n: FOLLOW_UPS_RANGE.min + i }),
                }))}
                data-testid="opt-followups"
              />
            )}
          </FieldRow>

          <FieldRow label={t('setup.opt.timeLimit')} labelWidth={196}>
            {(id) => (
              <Segmented<number>
                ariaLabelledBy={id}
                value={options.answerTimeLimitSec}
                onChange={(answerTimeLimitSec) => setOptions({ answerTimeLimitSec })}
                options={TIME_LIMITS.map((s) => ({ value: s, label: s === 0 ? t('setup.opt.timeOff') : t('common.seconds', { n: s }) }))}
                data-testid="opt-timelimit"
              />
            )}
          </FieldRow>
        </div>
      </section>

      <DeviceCheck />
    </div>
  );
}
