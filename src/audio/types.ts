/** Public audio names (re-exported from ./index). */

export type SfxName =
  | 'click'
  | 'hover'
  | 'confirm'
  | 'cancel'
  | 'blip' // typewriter tick
  | 'page' // advance dialogue page
  | 'affinityUp'
  | 'affinityDown'
  | 'chapter'
  | 'micOn'
  | 'micOff'
  | 'notify'
  | 'stamp'
  | 'fanfare'
  | 'sad';

export const SFX_NAMES: readonly SfxName[] = [
  'click',
  'hover',
  'confirm',
  'cancel',
  'blip',
  'page',
  'affinityUp',
  'affinityDown',
  'chapter',
  'micOn',
  'micOff',
  'notify',
  'stamp',
  'fanfare',
  'sad',
];

export type BgmTrack = 'title' | 'interview' | 'tense' | 'ending_good' | 'ending_bad';

export const BGM_TRACKS: readonly BgmTrack[] = ['title', 'interview', 'tense', 'ending_good', 'ending_bad'];
