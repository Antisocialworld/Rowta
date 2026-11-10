// test-swap-view-schema.ts — pure-logic tests for swap view schema parsing (PRD 8.5, 12; rules V1, V3).
// Verifies that shiftDeleted: boolean is preserved, omitted field defaults to undefined, and invalid types are rejected.
import assert from 'node:assert/strict';
import type { SwapRequestView } from '@rowta/shared';
import { parseSwapView, swapViewSchema } from '../src/lib/api';

const baseValidPayload = {
  id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  teamId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
  shiftId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13',
  requestedBy: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14',
  targetUserId: null,
  status: 'pending' as const,
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-10-28T12:00:00.000Z',
  updatedAt: '2026-10-28T12:00:00.000Z',
  shiftLabel: 'Morning shift',
  shiftStartsAt: '2026-10-29T08:00:00.000Z',
  shiftEndsAt: '2026-10-29T16:00:00.000Z',
};

// Compile-time static check: parseSwapView return type agrees with SwapRequestView without "as" casts.
const _staticAgreementCheck: SwapRequestView = parseSwapView(baseValidPayload);
void _staticAgreementCheck;

function testPreservesShiftDeletedTrue(): void {
  const payload = {
    ...baseValidPayload,
    shiftDeleted: true,
  };
  const parsed = parseSwapView(payload);
  assert.equal(parsed.shiftDeleted, true, 'payload with shiftDeleted true must keep shiftDeleted true after parse');
}

function testPreservesShiftDeletedFalse(): void {
  const payload = {
    ...baseValidPayload,
    shiftDeleted: false,
  };
  const parsed = parseSwapView(payload);
  assert.equal(parsed.shiftDeleted, false, 'payload with shiftDeleted false must keep shiftDeleted false after parse');
}

function testOmittedShiftDeletedIsUndefined(): void {
  const payload = {
    ...baseValidPayload,
  };
  const parsed = parseSwapView(payload);
  assert.equal(parsed.shiftDeleted, undefined, 'payload without shiftDeleted must parse with it undefined');
}

function testRejectsShiftDeletedAsString(): void {
  const payload = {
    ...baseValidPayload,
    shiftDeleted: 'true',
  };
  assert.throws(
    () => {
      parseSwapView(payload);
    },
    (err: unknown) => {
      assert.ok(err instanceof Error, 'must throw an error on string shiftDeleted');
      return true;
    },
    'shiftDeleted as a string must be rejected by schema',
  );
}

function testSchemaExportParsesDirectly(): void {
  const payload = {
    ...baseValidPayload,
    shiftDeleted: true,
  };
  const parsed = swapViewSchema.parse(payload);
  const typedView: SwapRequestView = parsed;
  assert.equal(typedView.shiftDeleted, true);
}

function runAll(): void {
  testPreservesShiftDeletedTrue();
  testPreservesShiftDeletedFalse();
  testOmittedShiftDeletedIsUndefined();
  testRejectsShiftDeletedAsString();
  testSchemaExportParsesDirectly();
  console.log('test-swap-view-schema: 5 assertion suites passed');
}

runAll();

