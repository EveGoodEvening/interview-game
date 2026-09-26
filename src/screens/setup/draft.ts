/**
 * In-memory Setup wizard state. Lives outside the component so a trip to Config
 * (Setup → Settings → back) restores the wizard exactly where the player left it.
 */
import { create } from 'zustand';
import { CHARACTERS } from '../../characters';
import type { CharacterId, InterviewConfig, InterviewRecord, Lang, ScreenId } from '../../types';
import {
  createDraft,
  draftFromConfig,
  EMPTY_RESUME,
  loadPersistedSetup,
  sampleResume,
  type ResumeDraft,
  type SetupDraft,
  type SetupOptions,
  type SetupStep,
} from './model';

export interface SetupEntry {
  /** Screen shown before Setup (null on first load). */
  from: ScreenId | null;
  lastRecord: InterviewRecord | null;
  /**
   * The full config of `lastRecord` while it is still in memory (the stored record keeps only the
   * first 4000 résumé characters); preferred over `lastRecord.config` for "Try again".
   */
  lastConfig?: InterviewConfig | null;
  uiLang: Lang;
}

interface SetupState extends SetupDraft {
  initialized: boolean;
  /** Direction of the last step change, for the slide animation. */
  direction: 1 | -1;
  init: (entry: SetupEntry) => void;
  goTo: (step: SetupStep) => void;
  setCharacter: (id: CharacterId) => void;
  setResume: (resume: ResumeDraft) => void;
  editResumeText: (text: string) => void;
  clearResume: () => void;
  setOptions: (patch: Partial<SetupOptions>) => void;
  /** Interview language; swaps an untouched sample résumé to the matching language. */
  setLang: (lang: Lang) => void;
  /** After the interview started: next visit begins at step 1 (character + résumé kept). */
  finish: () => void;
  /** Forget everything (Config → Data): the next visit starts from defaults, without a résumé. */
  reset: () => void;
}

let pendingPrefill: InterviewConfig | null = null;

/**
 * Ask the next Setup visit to prefill everything from `config` (e.g. Result → "Try again").
 * Setup also does this automatically when entered straight from the Result screen.
 */
export function requestSetupPrefill(config: InterviewConfig): void {
  pendingPrefill = config;
}

export const useSetupStore = create<SetupState>()((set, get) => ({
  ...createDraft('zh'),
  initialized: false,
  direction: 1,

  init: ({ from, lastRecord, lastConfig, uiLang }) => {
    const prefill = pendingPrefill ?? (from === 'result' ? (lastConfig ?? lastRecord?.config ?? null) : null);
    pendingPrefill = null;
    if (prefill) {
      set({ ...draftFromConfig(prefill), initialized: true, direction: 1 });
      return;
    }
    const s = get();
    if (!s.initialized) {
      set({ ...createDraft(uiLang, loadPersistedSetup(uiLang)), initialized: true, direction: 1 });
      return;
    }
    // Returning from Config: restore as-is. From anywhere else: start over at step 1 but keep choices.
    if (from !== 'settings') set({ step: 0, prefilled: false, direction: 1 });
  },

  goTo: (step) => set((s) => ({ step, direction: step >= s.step ? 1 : -1 })),

  setCharacter: (id) =>
    set((s) => ({
      characterId: id,
      options: s.options.styleTouched ? s.options : { ...s.options, style: CHARACTERS[id].defaultStyle },
    })),

  setResume: (resume) => set({ resume }),

  editResumeText: (text) =>
    set((s) => ({
      resume: {
        ...s.resume,
        text,
        source: s.resume.source === 'none' ? 'paste' : s.resume.source,
        warnings: [],
        edited: true,
      },
    })),

  clearResume: () => set({ resume: EMPTY_RESUME }),

  setOptions: (patch) => set((s) => ({ options: { ...s.options, ...patch } })),

  setLang: (lang) =>
    set((s) => {
      const swapSample = s.resume.source === 'sample' && !s.resume.edited;
      return { options: { ...s.options, lang }, resume: swapSample ? sampleResume(lang) : s.resume };
    }),

  finish: () => set({ step: 0, prefilled: false, direction: 1 }),

  reset: () => {
    pendingPrefill = null;
    set({ ...createDraft(get().options.lang), initialized: false, direction: 1 });
  },
}));
