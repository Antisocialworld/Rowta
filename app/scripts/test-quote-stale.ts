// Unit tests for stale checkout error handling (Task H23).
import assert from 'node:assert/strict';
import { errorMessageKey } from '../src/lib/api';
import { en } from '../src/i18n/en';

// 1. Error mapping: billing.checkout_stale maps to billing.error.checkoutStale
const mappedKey = errorMessageKey('billing.checkout_stale');
assert.equal(mappedKey, 'billing.error.checkoutStale', 'billing.checkout_stale must map to billing.error.checkoutStale');

// 2. Catalog text check: sentence case, tells user what happened and what to do
const errorMessage = en[mappedKey];
assert.ok(errorMessage, 'Catalog message must exist');
assert.equal(errorMessage, 'This payment link has expired. Start a new payment.');

// 3. Start a new payment button label exists
const actionLabel = en['billing.quote.startNewPayment'];
assert.ok(actionLabel, 'Button label for start new payment must exist');
assert.equal(actionLabel, 'Start a new payment');

// 4. Retry status message for H24 exists
const notConfirmedMessage = en['billing.complete.notConfirmedYet'];
assert.ok(notConfirmedMessage, 'Not confirmed message must exist');
assert.equal(notConfirmedMessage, 'Payment not confirmed yet. If you paid, wait a minute and retry.');

console.log('PASS test-quote-stale (all assertions passed)');

