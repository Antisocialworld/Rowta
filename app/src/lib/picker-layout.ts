// Pure layout calculations and sizing budget for DateTimePickerModal (rule X6, ADR 0021).
// Zero react-native or component imports so tests run in plain tsx without Flow parser errors.
import { spacing } from '../theme/tokens';

export const PICKER_CENTERING_PADDING = Number(spacing.small);
export const PICKER_DIALOG_PADDING = Number(spacing.base);
export const PICKER_CELL_MAX_WIDTH = 44;
export const PICKER_WEEK_DAYS_COUNT = 7;
export const PICKER_STEPPER_GAP = Number(spacing.small);

// Stepper internal layout constants
export const STEPPER_BUTTON_SIZE = 44;
export const STEPPER_VALUE_MIN_WIDTH = 40;
export const STEPPER_INTERNAL_GAP = Number(spacing.small);
export const STEPPER_CONTROLS_PADDING = Number(spacing.extraSmall);

// Derived stepper group width: 2 buttons + value text + 2 internal gaps + 2 padding margins
export const PICKER_STEPPER_GROUP_WIDTH =
  2 * STEPPER_BUTTON_SIZE +
  STEPPER_VALUE_MIN_WIDTH +
  2 * STEPPER_INTERNAL_GAP +
  2 * STEPPER_CONTROLS_PADDING;

export function computePickerInnerWidth(screenWidth: number): number {
  return screenWidth - 2 * PICKER_CENTERING_PADDING - 2 * PICKER_DIALOG_PADDING;
}

export function computeCalendarRowWidth(): number {
  return PICKER_WEEK_DAYS_COUNT * PICKER_CELL_MAX_WIDTH;
}

export function computeSteppersRowWidth(): number {
  return 2 * PICKER_STEPPER_GROUP_WIDTH + PICKER_STEPPER_GAP;
}

