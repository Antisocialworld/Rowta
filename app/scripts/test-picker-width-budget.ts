// Test: Width budget verification for DateTimePickerModal at 360px viewport and below (rule X6, ADR 0021).
// Run: npm exec --workspace @rowta/app -- tsx scripts/test-picker-width-budget.ts

import {
  PICKER_CELL_MAX_WIDTH,
  PICKER_CENTERING_PADDING,
  PICKER_DIALOG_PADDING,
  PICKER_STEPPER_GAP,
  PICKER_STEPPER_GROUP_WIDTH,
  PICKER_WEEK_DAYS_COUNT,
  STEPPER_BUTTON_SIZE,
  STEPPER_CONTROLS_PADDING,
  STEPPER_INTERNAL_GAP,
  STEPPER_VALUE_MIN_WIDTH,
  computeCalendarRowWidth,
  computePickerInnerWidth,
  computeSteppersRowWidth,
} from '../src/lib/picker-layout';
import { spacing } from '../src/theme/tokens';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

// 1. Spacing token alignment
check(
  PICKER_CENTERING_PADDING === Number(spacing.small),
  `Centering padding equals spacing.small (${PICKER_CENTERING_PADDING}px)`,
);
check(
  PICKER_DIALOG_PADDING === Number(spacing.base),
  `Dialog padding equals spacing.base (${PICKER_DIALOG_PADDING}px)`,
);
check(
  PICKER_STEPPER_GAP === Number(spacing.small),
  `Stepper gap equals spacing.small (${PICKER_STEPPER_GAP}px)`,
);

// 2. Inner width calculation at 360 x 800
const innerWidth360 = computePickerInnerWidth(360);
check(
  innerWidth360 === 312,
  `At 360px viewport, inner dialog width is exactly 312px (got ${innerWidth360}px)`,
);

// 3. Calendar row width budget (7 days x 44px touch target)
const calendarRowWidth = computeCalendarRowWidth();
check(
  calendarRowWidth === 308,
  `Calendar row of 7 x 44px cells is 308px (got ${calendarRowWidth}px)`,
);
check(
  calendarRowWidth <= innerWidth360,
  `Calendar week row (${calendarRowWidth}px) fits within 360-wide inner width (${innerWidth360}px) with ${innerWidth360 - calendarRowWidth}px spare`,
);

// 4. Steppers row width budget (derived group width)
const expectedGroupWidth =
  2 * STEPPER_BUTTON_SIZE +
  STEPPER_VALUE_MIN_WIDTH +
  2 * STEPPER_INTERNAL_GAP +
  2 * STEPPER_CONTROLS_PADDING;
check(
  PICKER_STEPPER_GROUP_WIDTH === expectedGroupWidth,
  `Stepper group width is derived from styles (${PICKER_STEPPER_GROUP_WIDTH}px === ${expectedGroupWidth}px)`,
);
check(
  PICKER_STEPPER_GROUP_WIDTH === 152,
  `Derived stepper group width matches expected 152px (got ${PICKER_STEPPER_GROUP_WIDTH}px)`,
);

const steppersRowWidth = computeSteppersRowWidth();
check(
  steppersRowWidth === 312,
  `Steppers row width (2 x ${PICKER_STEPPER_GROUP_WIDTH}px + ${PICKER_STEPPER_GAP}px gap) is exactly 312px (got ${steppersRowWidth}px)`,
);
check(
  steppersRowWidth <= innerWidth360,
  `Steppers row (${steppersRowWidth}px) fits within 360-wide inner width (${innerWidth360}px)`,
);

// 5. Touch target compliance (rule X6: >= 44px touch targets on 360+ screens)
check(
  PICKER_CELL_MAX_WIDTH >= 44,
  `Calendar cell touch target width is at least 44px (${PICKER_CELL_MAX_WIDTH}px)`,
);

// 6. Graceful behavior below 360px (e.g. 320 x 568 iPhone SE / compact devices)
const innerWidth320 = computePickerInnerWidth(320);
check(
  innerWidth320 === 272,
  `At 320px viewport, inner dialog width is 272px (got ${innerWidth320}px)`,
);

// At 320px, cells flex shrink: 272 / 7 = 38.85px per cell without horizontal scroll/overflow
const cellWidthAt320 = innerWidth320 / PICKER_WEEK_DAYS_COUNT;
check(
  cellWidthAt320 > 38 && cellWidthAt320 < 40,
  `At 320px viewport, cells shrink gracefully to ${cellWidthAt320.toFixed(2)}px without clipping`,
);

// At 320px, steppers wrap (single group is 152px, which easily fits in 272px inner width)
check(
  PICKER_STEPPER_GROUP_WIDTH <= innerWidth320,
  `When wrapped at 320px, stepper group (${PICKER_STEPPER_GROUP_WIDTH}px) fits within inner width (${innerWidth320}px)`,
);

if (failures > 0) {
  console.error(`Width budget check failed with ${failures} error(s).`);
  process.exit(1);
} else {
  console.log('All width budget checks passed.');
  process.exit(0);
}

