import { Segmented } from '../../components/ui/Segmented';
import { useT, useUiLang } from '../../i18n';
import { useSettingsStore } from '../../store/settings';
import type { Lang } from '../../types';

/** 中 / EN toggle for the interface language. */
export function LangSwitch({ className = '' }: { className?: string }) {
  const t = useT();
  const lang = useUiLang();
  return (
    <Segmented<Lang>
      size="sm"
      className={className}
      value={lang}
      ariaLabel={t('title.langToggle')}
      options={[
        { value: 'zh', label: t('common.lang.short.zh'), hint: t('common.lang.zh') },
        { value: 'en', label: t('common.lang.short.en'), hint: t('common.lang.en') },
      ]}
      onChange={(uiLang) => useSettingsStore.getState().update({ display: { uiLang } })}
      data-testid="lang-switch"
    />
  );
}
