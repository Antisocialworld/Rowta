// QUOTE PARAMS RESOLUTION LOGIC TEST (Task H16)
// Tests the pure resolution helper resolveQuoteParams from quote-params.ts.
// Run from repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-quote-params.ts
import { resolveQuoteParams, DEFAULT_QUOTE_PARAMS, canSwitchBillingInterval } from '../src/lib/quote-params';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

// 1. Yearly subscribe is returned unchanged
{
  const input = {
    action: 'subscribe' as const,
    interval: 'yearly' as const,
    teamId: undefined,
    people: undefined,
  };
  const result = resolveQuoteParams(input);
  check(
    result.action === 'subscribe' &&
      result.interval === 'yearly' &&
      result.teamId === undefined &&
      result.people === undefined,
    'yearly subscribe is returned unchanged',
  );
}

// 2. switch_interval yearly is returned unchanged
{
  const input = {
    action: 'switch_interval' as const,
    interval: 'yearly' as const,
    teamId: undefined,
    people: undefined,
  };
  const result = resolveQuoteParams(input);
  check(
    result.action === 'switch_interval' &&
      result.interval === 'yearly' &&
      result.teamId === undefined &&
      result.people === undefined,
    'switch_interval yearly is returned unchanged',
  );
}

// 3. add_team with teamId is returned unchanged
{
  const input = {
    action: 'add_team' as const,
    interval: undefined,
    teamId: '00000000-0000-0000-0000-000000000001',
    people: undefined,
  };
  const result = resolveQuoteParams(input);
  check(
    result.action === 'add_team' &&
      result.interval === undefined &&
      result.teamId === '00000000-0000-0000-0000-000000000001' &&
      result.people === undefined,
    'add_team with teamId is returned unchanged',
  );
}

// 4. add_people with teamId and people is returned unchanged
{
  const input = {
    action: 'add_people' as const,
    interval: undefined,
    teamId: '00000000-0000-0000-0000-000000000001',
    people: 25,
  };
  const result = resolveQuoteParams(input);
  check(
    result.action === 'add_people' &&
      result.interval === undefined &&
      result.teamId === '00000000-0000-0000-0000-000000000001' &&
      result.people === 25,
    'add_people with teamId and people is returned unchanged',
  );
}

// 5. null returns the monthly subscribe default
{
  const result = resolveQuoteParams(null);
  check(
    result.action === 'subscribe' &&
      result.interval === 'monthly' &&
      result.teamId === undefined &&
      result.people === undefined,
    'null returns the monthly subscribe default',
  );
  check(
    result === DEFAULT_QUOTE_PARAMS,
    'null returns DEFAULT_QUOTE_PARAMS reference',
  );
}

// 6. canSwitchBillingInterval: monthly plan can switch interval
check(
  canSwitchBillingInterval('monthly') === true,
  'canSwitchBillingInterval returns true for monthly plan',
);

// 7. canSwitchBillingInterval: yearly plan CANNOT switch to monthly
check(
  canSwitchBillingInterval('yearly') === false,
  'canSwitchBillingInterval returns false for yearly plan',
);

// 8. canSwitchBillingInterval: null / undefined / other cannot switch
check(
  canSwitchBillingInterval(null) === false,
  'canSwitchBillingInterval returns false for null',
);
check(
  canSwitchBillingInterval(undefined) === false,
  'canSwitchBillingInterval returns false for undefined',
);
check(
  canSwitchBillingInterval('unknown') === false,
  'canSwitchBillingInterval returns false for unknown plan',
);

process.exit(failures === 0 ? 0 : 1);

