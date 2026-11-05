// Pure layout calculations and sizing budget for SheetModal (rule X6, ADR 0018, ADR 0021).
// Zero react-native or component imports so tests run in plain tsx without Flow parser errors.
import { spacing } from '../theme/tokens';

export const SHEET_CENTERING_PADDING = Number(spacing.small); // 8 px
export const SHEET_DIALOG_PADDING = Number(spacing.base); // 16 px
export const SHEET_MAX_HEIGHT_PERCENT = 85;

export function computeSheetInnerWidth(screenWidth: number): number {
  return screenWidth - 2 * SHEET_CENTERING_PADDING - 2 * SHEET_DIALOG_PADDING;
}

