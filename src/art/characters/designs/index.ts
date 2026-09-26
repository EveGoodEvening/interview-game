import type { CharacterId } from '../../../types';
import type { CharacterDesign } from '../model';
import { ETHAN } from './ethan';
import { HARU } from './haru';
import { YUKI } from './yuki';

/** Drawing data for every interviewer. */
export const DESIGNS: Record<CharacterId, CharacterDesign> = { yuki: YUKI, ethan: ETHAN, haru: HARU };
