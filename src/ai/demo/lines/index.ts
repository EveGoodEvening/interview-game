import type { CharacterId } from '../../../types';
import { ETHAN_LINES } from './ethan';
import { HARU_LINES } from './haru';
import type { CharacterLines } from './types';
import { YUKI_LINES } from './yuki';

export * from './types';
export { SHARED_QUESTIONS } from './shared';

export const CHARACTER_LINES: Record<CharacterId, CharacterLines> = {
  yuki: YUKI_LINES,
  ethan: ETHAN_LINES,
  haru: HARU_LINES,
};
