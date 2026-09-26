/**
 * Which Config tab opens next. Kept apart from SettingsScreen so other screens (e.g. the interview
 * error dialog → 'llm') can pick the tab without pulling the lazily loaded Settings screen into
 * their bundle.
 */
export type SettingsTab = 'llm' | 'voice' | 'display' | 'audio' | 'data';

let lastTab: SettingsTab = 'llm';

/** Open Config on a specific tab next time (e.g. the interview error dialog → 'llm'). */
export function setSettingsTab(tab: SettingsTab): void {
  lastTab = tab;
}

/** The tab Config opens on (the last one chosen during this app session). */
export function getSettingsTab(): SettingsTab {
  return lastTab;
}
