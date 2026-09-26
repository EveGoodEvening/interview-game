import { useState, type CSSProperties } from 'react';
import { CharacterPortrait } from '../art';
import { CHARACTERS } from '../characters';
import { Chip } from '../components/ui/Chip';
import { MenuFrame } from '../components/ui/MenuFrame';
import { Tabs, type TabItem } from '../components/ui/Tabs';
import { useT } from '../i18n';
import { useGameStore } from '../store/game';
import type { CharacterId } from '../types';
import { AudioTab } from './settings/AudioTab';
import { DataTab } from './settings/DataTab';
import { DisplayTab } from './settings/DisplayTab';
import { LlmTab } from './settings/LlmTab';
import { VoiceTab } from './settings/VoiceTab';
import './SettingsScreen.css';

import { getSettingsTab, setSettingsTab, type SettingsTab } from './settings/tabState';

export { setSettingsTab, type SettingsTab } from './settings/tabState';

const TAB_ICONS = { llm: 'chip', voice: 'mic', display: 'monitor', audio: 'music', data: 'database' } as const;
const TAB_GUIDE: Record<SettingsTab, CharacterId> = { llm: 'yuki', voice: 'ethan', display: 'haru', audio: 'yuki', data: 'ethan' };
const TAB_IDS: readonly SettingsTab[] = ['llm', 'voice', 'display', 'audio', 'data'];

/** Config: tabbed settings panel. Every change is saved immediately by the settings store. */
export function SettingsScreen() {
  const t = useT();
  const [tab, setTab] = useState<SettingsTab>(getSettingsTab);
  const guide = CHARACTERS[TAB_GUIDE[tab]];

  const choose = (next: SettingsTab) => {
    setSettingsTab(next);
    setTab(next);
  };

  const items: TabItem<SettingsTab>[] = TAB_IDS.map((id) => ({
    id,
    label: t(`settings.tab.${id}`),
    sub: t(`settings.tab.${id}.sub`),
    icon: TAB_ICONS[id],
  }));

  return (
    <MenuFrame
      kicker={t('settings.kicker')}
      title={t('settings.title')}
      backLabel={t('common.back')}
      onBack={() => useGameStore.getState().closeSettings()}
      extra={
        <Chip tone="mint" icon="check">
          {t('settings.autosaved')}
        </Chip>
      }
      petals={false}
      className="cfg-screen"
      data-testid="screen-SettingsScreen"
    >
      <div className="cfg">
        <aside className="cfg__side">
          <Tabs items={items} value={tab} onChange={choose} orientation="vertical" ariaLabel={t('settings.tabsLabel')} idPrefix="cfg" />
          <div className="cfg__guide" style={{ '--guide-c': guide.themeColor } as CSSProperties} key={tab}>
            <div className="cfg__bubble">{t(`settings.tip.${tab}`)}</div>
            <CharacterPortrait characterId={guide.id} expression="smile" size={92} className="cfg__guide-portrait" />
          </div>
        </aside>
        <div className="cfg__panel gg-scroll" role="tabpanel" id={`cfg-panel-${tab}`} aria-labelledby={`cfg-tab-${tab}`} key={tab}>
          {tab === 'llm' && <LlmTab />}
          {tab === 'voice' && <VoiceTab />}
          {tab === 'display' && <DisplayTab />}
          {tab === 'audio' && <AudioTab />}
          {tab === 'data' && <DataTab />}
        </div>
      </div>
    </MenuFrame>
  );
}
