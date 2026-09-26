import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { CharacterPortrait } from '../../art';
import { playSfx } from '../../audio';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Hint } from '../../components/ui/Hint';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { TextArea } from '../../components/ui/TextField';
import { toast } from '../../components/ui/Toast';
import { useT, useUiLang } from '../../i18n';
import { ACCEPTED_RESUME_TYPES, describeResumeError, describeResumeWarning, MAX_RESUME_CHARS, parseResumeFile } from '../../resume';
import { useSetupStore } from './draft';
import { parseSetupWarning, sampleResume, validateDraft } from './model';
import './StepResume.css';

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/** Step 2 — upload / sample / paste the résumé, then review it in an editable preview. */
export function StepResume() {
  const t = useT();
  const uiLang = useUiLang();
  const resume = useSetupStore((s) => s.resume);
  const options = useSetupStore((s) => s.options);
  const characterId = useSetupStore((s) => s.characterId);
  const { setResume, editResumeText, clearResume } = useSetupStore.getState();
  const [parsing, setParsing] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const parseSeq = useRef(0);

  // Dropping a file outside the zone must not make the browser navigate away from the game.
  useEffect(() => {
    const stop = (e: globalThis.DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  const readFile = async (file: File) => {
    const seq = ++parseSeq.current;
    setParsing(true);
    setError(null);
    try {
      const parsed = await parseResumeFile(file);
      if (seq !== parseSeq.current) return;
      setResume({
        text: parsed.text,
        fileName: parsed.fileName,
        source: 'file',
        warnings: parsed.warnings,
        edited: false,
        ...(parsed.pageCount !== undefined ? { pageCount: parsed.pageCount } : {}),
      });
      playSfx('notify');
      toast(t('setup.resume.loaded', { name: parsed.fileName, n: parsed.text.length }), { kind: 'success' });
    } catch (err) {
      if (seq !== parseSeq.current) return;
      playSfx('cancel');
      setError(describeResumeError(err, uiLang));
    } finally {
      if (seq === parseSeq.current) setParsing(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragDepth(0);
    const file = e.dataTransfer.files?.[0];
    if (file && !parsing) void readFile(file);
  };

  const openPicker = () => {
    if (parsing) return;
    playSfx('click');
    inputRef.current?.click();
  };

  const onZoneKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPicker();
    }
  };

  const useSample = () => {
    parseSeq.current++;
    setParsing(false);
    setError(null);
    setResume(sampleResume(options.lang));
  };

  const startPaste = () => {
    setError(null);
    textRef.current?.focus();
  };

  const issues = validateDraft({ resume, options }).filter((i) => i.step === 1 && i.level === 'warning');
  const dragging = dragDepth > 0;
  const hasText = resume.text.length > 0;

  return (
    <div className="su-resume">
      <div className="su-resume__left">
        <div className="su-heading">
          <h2 className="su-heading__title">{t('setup.resume.heading')}</h2>
          <p className="su-heading__sub">{t('setup.resume.sub')}</p>
        </div>

        <div
          className={`su-drop${dragging ? ' su-drop--over' : ''}${parsing ? ' su-drop--busy' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={t('setup.resume.dropLabel')}
          aria-busy={parsing || undefined}
          onClick={openPicker}
          onKeyDown={onZoneKey}
          onDragEnter={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            setDragDepth((d) => d + 1);
          }}
          onDragOver={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={() => setDragDepth((d) => Math.max(0, d - 1))}
          onDrop={onDrop}
          data-testid="resume-drop"
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_RESUME_TYPES}
            className="gg-visually-hidden"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file) void readFile(file);
            }}
            data-testid="resume-file"
          />
          <div className="su-drop__art" aria-hidden="true">
            <Icon name="file" size={46} strokeWidth={1.6} className="su-drop__file" />
            <span className="su-drop__arrow">
              <Icon name="upload" size={20} strokeWidth={2.4} />
            </span>
          </div>
          <div className="su-drop__title">{dragging ? t('setup.resume.dropActive') : t('setup.resume.dropTitle')}</div>
          <div className="su-drop__or">{t('setup.resume.dropOr')}</div>
          <div className="su-drop__types">{t('setup.resume.dropTypes')}</div>
          {parsing && (
            <div className="su-drop__busy">
              <Spinner size={30} />
              <span>{t('setup.resume.parsing')}</span>
            </div>
          )}
        </div>

        {error && (
          <Hint kind="error" data-testid="resume-error">
            <strong>{t('setup.resume.failed')}</strong> — {error}
          </Hint>
        )}

        <div className="su-resume__alt">
          <Button icon="sparkle" onClick={useSample} disabled={parsing} data-testid="resume-sample">
            {t('setup.resume.sample')}
          </Button>
          <Button icon="paste" onClick={startPaste} disabled={parsing} data-testid="resume-paste">
            {t('setup.resume.paste')}
          </Button>
        </div>

        <p className="su-resume__privacy">
          <Icon name="lock" size={13} />
          {t('setup.resume.privacy')}
        </p>
      </div>

      <section className="su-preview" aria-label={t('setup.resume.previewTitle')}>
        <header className="su-preview__head">
          <Icon name="book" size={18} className="su-preview__icon" />
          <h3 className="su-preview__title">{t('setup.resume.previewTitle')}</h3>
          {resume.source === 'file' && (
            <Chip tone="lavender" icon="file" title={resume.fileName}>
              {resume.fileName}
              {resume.pageCount ? ` · ${t('setup.resume.pages', { n: resume.pageCount })}` : ''}
            </Chip>
          )}
          {resume.source === 'sample' && (
            <Chip tone="gold" icon="sparkle">
              {t('setup.resume.source.sample')}
            </Chip>
          )}
          {resume.source === 'paste' && hasText && (
            <Chip tone="sky" icon="paste">
              {t('setup.resume.source.paste')}
            </Chip>
          )}
          <span className="su-preview__spacer" />
          <span className={`su-preview__count${resume.text.length >= MAX_RESUME_CHARS ? ' su-preview__count--max' : ''}`}>
            {t('setup.resume.count', { n: resume.text.length.toLocaleString(), max: MAX_RESUME_CHARS.toLocaleString() })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            icon="trash"
            sfx="cancel"
            disabled={!hasText}
            onClick={() => {
              clearResume();
              toast(t('setup.resume.cleared'));
            }}
            data-testid="resume-clear"
          >
            {t('setup.resume.clear')}
          </Button>
        </header>

        <div className="su-preview__body">
          <TextArea
            ref={textRef}
            className="su-preview__text"
            value={resume.text}
            onChange={editResumeText}
            maxLength={MAX_RESUME_CHARS}
            placeholder={t('setup.resume.placeholder')}
            spellCheck={false}
            aria-label={t('setup.resume.previewTitle')}
            data-testid="resume-text"
          />
          {!hasText && (
            <div className="su-preview__empty" aria-hidden="true">
              <CharacterPortrait characterId={characterId} expression="thinking" size={84} />
              <div>
                <div className="su-preview__empty-title">{t('setup.resume.emptyTitle')}</div>
                <div className="su-preview__empty-body">{t('setup.resume.emptyBody')}</div>
              </div>
            </div>
          )}
        </div>

        {(resume.warnings.length > 0 || issues.length > 0) && (
          <div className="su-preview__notes">
            {resume.warnings.map((w) => {
              const own = parseSetupWarning(w);
              if (own) {
                // Setup's own notes (e.g. "this résumé was shortened in the saved record") stand out.
                return (
                  <Hint key={w} kind="warn" data-testid={`resume-warning-${own.code}`}>
                    {t(`setup.resume.warn.${own.code}`, { n: Number(own.detail).toLocaleString(uiLang === 'zh' ? 'zh-CN' : 'en-US') })}
                  </Hint>
                );
              }
              return (
                <Hint key={w} kind="warn" compact>
                  {describeResumeWarning(w, uiLang)}
                </Hint>
              );
            })}
            {issues.map((i) => (
              <Hint key={i.code} kind="warn" compact>
                {t(`setup.issue.${i.code}`)}
              </Hint>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
