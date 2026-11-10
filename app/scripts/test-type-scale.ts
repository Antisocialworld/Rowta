// test-type-scale.ts — verifies type scale minimums, line height ratios, and touch targets (Task 2; rules U5, X6; ADR 0021).
// Verifies:
// 1. All type styles have line-height ratio >= 1.4.
// 2. All type styles have fontSize >= 14 px, except the explicit decorative badge exception (label-small at 12 px semibold).
// 3. body-medium (primary text) has fontSize >= 16 px.
// 4. title-medium (team card titles / section headers) has fontSize = 18 px and fontWeight = '600' (semibold).
// 5. MIN_TOUCH_TARGET = 44 px.
// NOTE: Written per standing rules; do not run unless explicitly authorized by the owner.

import { typeStyles } from '../src/theme/tokens';
import { MIN_TOUCH_TARGET } from '../src/theme/layout-constants';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

console.log('--- 1. Touch target minimums ---');
check(MIN_TOUCH_TARGET === 44, `MIN_TOUCH_TARGET is 44 px (got ${MIN_TOUCH_TARGET})`);

console.log('\n--- 2. Type style line-height ratios (>= 1.4) ---');
for (const [name, style] of Object.entries(typeStyles)) {
  const ratio = style.lineHeight / style.fontSize;
  check(
    ratio >= 1.4,
    `Style "${name}" (${style.fontSize}px / ${style.lineHeight}px) has line-height ratio ${ratio.toFixed(3)} >= 1.4`,
  );
}

console.log('\n--- 3. Type scale floor (>= 14 px floor, label-small exception at 12 px) ---');
for (const [name, style] of Object.entries(typeStyles)) {
  if (name === 'label-small') {
    check(
      style.fontSize === 12 && style.fontWeight === '600',
      `Style "${name}" is explicit decorative exception: 12 px semibold (got ${style.fontSize}px, weight ${style.fontWeight})`,
    );
  } else {
    check(
      style.fontSize >= 14,
      `Style "${name}" has fontSize ${style.fontSize}px >= 14px floor`,
    );
  }
}

console.log('\n--- 4. Primary text and card title specifications ---');
const bodyMedium = typeStyles['body-medium'];
check(
  bodyMedium.fontSize >= 16,
  `body-medium fontSize is ${bodyMedium.fontSize}px >= 16px (primary text floor)`,
);

const titleMedium = typeStyles['title-medium'];
check(
  titleMedium.fontSize === 18 && titleMedium.fontWeight === '600',
  `title-medium is 18 px semibold (got ${titleMedium.fontSize}px, weight ${titleMedium.fontWeight})`,
);

if (failures > 0) {
  console.error(`\nFailed with ${failures} assertion failures.`);
  process.exit(1);
} else {
  console.log('\nAll type scale and touch target checks passed.');
}

