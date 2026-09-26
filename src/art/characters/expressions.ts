/**
 * Expression behaviour that is not in the pictures: the little hop on switching to it and the manga
 * symbol drawn next to the head (the troubled sweat drop is part of the painting).
 */
import type { Expression } from '../../types';

export interface ExpressionMotion {
  /** Small hop when switching to this expression. */
  hop: boolean;
  symbol: 'sparkle' | 'shock' | null;
}

export const EXPRESSION_MOTION: Record<Expression, ExpressionMotion> = {
  neutral: { hop: false, symbol: null },
  smile: { hop: false, symbol: null },
  happy: { hop: true, symbol: 'sparkle' },
  thinking: { hop: false, symbol: null },
  serious: { hop: false, symbol: null },
  surprised: { hop: true, symbol: 'shock' },
  troubled: { hop: false, symbol: null },
};
