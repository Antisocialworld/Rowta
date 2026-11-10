// Unit tests for shouldRenderInlineBack and shouldInlineAction (Task H21).
// Pure logic test: below, at, above breakpoint; undefined width means phone layout.
// Non-back actions stay pinned (Rule 3).
// Pure Node only: zero react-native or expo imports.
import assert from 'node:assert/strict';
import { COMPACT_MAX_WIDTH, shouldInlineAction, shouldRenderInlineBack } from '../src/lib/wide-layout';

// 1. Undefined width (initial render / SSR / mobile fallback) -> phone layout (false)
assert.equal(shouldRenderInlineBack(undefined, 'web'), false, 'undefined width on web must return false');
assert.equal(shouldRenderInlineBack(undefined, 'android'), false, 'undefined width on android must return false');
assert.equal(shouldRenderInlineBack(undefined, 'ios'), false, 'undefined width on ios must return false');

// 2. Below the breakpoint (e.g. 360, 400, 599) -> phone layout (false)
assert.equal(shouldRenderInlineBack(360, 'web'), false, '360px on web must return false');
assert.equal(shouldRenderInlineBack(400, 'web'), false, '400px on web must return false');
assert.equal(shouldRenderInlineBack(599, 'web'), false, '599px on web must return false');

// 3. At the breakpoint (600) -> phone layout (false)
assert.equal(shouldRenderInlineBack(COMPACT_MAX_WIDTH, 'web'), false, '600px (at breakpoint) on web must return false');

// 4. Above the breakpoint (e.g. 601, 768, 1024, 1440) -> inline back (true)
assert.equal(shouldRenderInlineBack(601, 'web'), true, '601px on web must return true');
assert.equal(shouldRenderInlineBack(768, 'web'), true, '768px on web must return true');
assert.equal(shouldRenderInlineBack(1024, 'web'), true, '1024px on web must return true');
assert.equal(shouldRenderInlineBack(1440, 'web'), true, '1440px on web must return true');

// 5. Non-web platforms are always false regardless of width
assert.equal(shouldRenderInlineBack(1024, 'android'), false, 'tablet width on android must return false');
assert.equal(shouldRenderInlineBack(1024, 'ios'), false, 'iPad width on ios must return false');

// 6. Shared decision: shouldInlineAction (Rule 1 & Rule 3)
// Back actions render inline on desktop web (> 600px)
assert.equal(shouldInlineAction(1024, 'web', 'action.back'), true, 'action.back on desktop web renders inline');
assert.equal(shouldInlineAction(601, 'web', 'action.back'), true, 'action.back above breakpoint renders inline');
assert.equal(shouldInlineAction(600, 'web', 'action.back'), false, 'action.back at breakpoint stays pinned');
assert.equal(shouldInlineAction(360, 'web', 'action.back'), false, 'action.back on mobile web stays pinned');
assert.equal(shouldInlineAction(1024, 'android', 'action.back'), false, 'action.back on native android stays pinned');
assert.equal(shouldInlineAction(1024, 'ios', 'action.back'), false, 'action.back on native ios stays pinned');

// Rule 3: Non-back actions (close, cancel, primary buttons) always stay pinned in footer
assert.equal(shouldInlineAction(1024, 'web', 'action.close'), false, 'action.close stays pinned in footer even on desktop web');
assert.equal(shouldInlineAction(1024, 'web', 'action.cancel'), false, 'action.cancel stays pinned in footer');
assert.equal(shouldInlineAction(1024, 'web', 'action.create'), false, 'action.create stays pinned in footer');
assert.equal(shouldInlineAction(1024, 'web', 'billing.card.retry'), false, 'retry action stays pinned in footer');

console.log('PASS test-wide-layout (all assertions passed)');
