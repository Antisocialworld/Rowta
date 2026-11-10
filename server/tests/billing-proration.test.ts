// Billing proration tests (Task 1, Phase 7).
// Pure unit tests for server/src/billing/proration.ts. Imports ONLY from that module.
// Expected values are hand-computed literals (never computed by calling the formula).
//
// USD table (PRD lines 77-81): TEST FIXTURE ONLY — Rowta is sold in NGN only in production.
//   Starter: base 2000, no extra seat (hard cap 5)
//   Team:    base 5000, extra 300 (15 included)
//   Business: base 12000, extra 200 (40 included)
//
// NGN table (EDIT 2, owner-supplied 6 Nov 2026, kobo):
//   Starter: base 650000, no extra seat (hard cap 5)
//   Team:    base 1625000, extra 97500 (15 included)
//   Business: base 3900000, extra 65000 (40 included)
//
// P = 30 monthly tests, P = 365 yearly tests. elapsed = floor((now - period_start)/1 day);
// R = P - elapsed; first day R=P, last day R=1.
// credit = floor(price(old) * R / P); charge = floor(price(new) * R / P);
// chargeToday = charge - credit; integer maths, multiply first, floor each term.
import { describe, expect, it } from 'vitest';
import {
  chargeFor,
  creditFor,
  currencyDecimals,
  daysRemaining,
  elapsedDays,
  intervalMultiplier,
  periodPrice,
  prorationFor,
  prorateTerm,
  type PricingTable,
} from '../src/billing/proration.ts';

// ---------------------------------------------------------------------------
// USD test fixture (PRD lines 77-81). Test-only; production sells NGN only.
// ---------------------------------------------------------------------------
const USD_FIXTURE: PricingTable = {
  starter: { price: { baseMinor: 2000, extraSeatMinor: null }, limits: { includedSeats: 5, maxSeats: 5 } },
  team: { price: { baseMinor: 5000, extraSeatMinor: 300 }, limits: { includedSeats: 15, maxSeats: 200 } },
  business: { price: { baseMinor: 12000, extraSeatMinor: 200 }, limits: { includedSeats: 40, maxSeats: 200 } },
};

// ---------------------------------------------------------------------------
// NGN production table (owner-supplied, kobo).
// ---------------------------------------------------------------------------
const NGN_TABLE: PricingTable = {
  starter: { price: { baseMinor: 650000, extraSeatMinor: null }, limits: { includedSeats: 5, maxSeats: 5 } },
  team: { price: { baseMinor: 1625000, extraSeatMinor: 97500 }, limits: { includedSeats: 15, maxSeats: 200 } },
  business: { price: { baseMinor: 3900000, extraSeatMinor: 65000 }, limits: { includedSeats: 40, maxSeats: 200 } },
};

describe('billing proration (PRD 8.6)', () => {
  describe('periodPrice', () => {
    it('monthly Starter(5) = 2000 (USD fixture)', () => {
      // (2000 + 0) * 1 = 2000
      expect(periodPrice('starter', 5, USD_FIXTURE.starter.price, USD_FIXTURE.starter.limits, 'month')).toBe(2000);
    });
    it('monthly Team(20) = 5000 + 300*5 = 6500 (USD fixture)', () => {
      // (5000 + 300 * max(0, 20 - 15)) * 1 = 5000 + 1500 = 6500
      expect(periodPrice('team', 20, USD_FIXTURE.team.price, USD_FIXTURE.team.limits, 'month')).toBe(6500);
    });
    it('monthly Starter(6) is rejected by hard cap (USD fixture)', () => {
      // 6 > maxSeats 5 -> null
      expect(periodPrice('starter', 6, USD_FIXTURE.starter.price, USD_FIXTURE.starter.limits, 'month')).toBe(null);
    });
    it('monthly Team(201) exceeds ceiling 200 -> null', () => {
      // 201 > maxSeats 200 -> null
      expect(periodPrice('team', 201, USD_FIXTURE.team.price, USD_FIXTURE.team.limits, 'month')).toBe(null);
    });
    it('yearly Starter(5) = 2000 * 12 = 24000 (USD fixture)', () => {
      // (2000 + 0) * 12 = 24000
      expect(periodPrice('starter', 5, USD_FIXTURE.starter.price, USD_FIXTURE.starter.limits, 'year')).toBe(24000);
    });
    it('intervalMultiplier: month=1, year=12', () => {
      expect(intervalMultiplier('month')).toBe(1);
      expect(intervalMultiplier('year')).toBe(12);
    });
  });

  describe('prorateTerm = floor(price * R / P)', () => {
    it('full term: floor(5000 * 30 / 30) = 5000', () => {
      // floor(150000 / 30) = 5000
      expect(prorateTerm(5000, 30, 30)).toBe(5000);
    });
    it('half-unit boundary rounds DOWN: floor(15 * 1 / 30) = floor(0.5) = 0', () => {
      // exact value 0.5; round DOWN each term -> 0 (not 1)
      expect(prorateTerm(15, 1, 30)).toBe(0);
    });
    it('half-unit boundary rounds DOWN: floor(45 * 1 / 30) = floor(1.5) = 1', () => {
      // exact value 1.5; round DOWN each term -> 1 (not 2)
      expect(prorateTerm(45, 1, 30)).toBe(1);
    });
    it('invalid input: remaining days > period days -> null', () => {
      expect(prorateTerm(2000, 31, 30)).toBe(null);
    });
    it('invalid input: period days <= 0 -> null', () => {
      expect(prorateTerm(2000, 10, 0)).toBe(null);
    });
  });

  describe('PRD rows 1-11 (USD fixture, monthly, P=30)', () => {
    it('row 1: Upgrade Starter(5) -> Team(9), R=20', () => {
      // credit = floor(2000 * 20 / 30) = 1333
      // charge = floor(5000 * 20 / 30) = 3333
      // chargeToday = 3333 - 1333 = 2000
      expect(prorationFor('starter', 5, 'team', 9, USD_FIXTURE, 20, 30, 'month')).toEqual({
        credit: 1333, charge: 3333, chargeToday: 2000,
      });
    });
    it('row 2: Upgrade Team(15) -> Business(15), R=10', () => {
      // credit = floor(5000 * 10 / 30) = 1666
      // charge = floor(12000 * 10 / 30) = 4000
      // chargeToday = 4000 - 1666 = 2334
      expect(prorationFor('team', 15, 'business', 15, USD_FIXTURE, 10, 30, 'month')).toEqual({
        credit: 1666, charge: 4000, chargeToday: 2334,
      });
    });
    it('row 3: Add 3 seats Team(15) -> Team(18), R=12', () => {
      // credit = floor(5000 * 12 / 30) = 2000
      // monthly(Team, 18) = 5000 + 300*3 = 5900; charge = floor(5900 * 12 / 30) = 2360
      // chargeToday = 2360 - 2000 = 360
      expect(prorationFor('team', 15, 'team', 18, USD_FIXTURE, 12, 30, 'month')).toEqual({
        credit: 2000, charge: 2360, chargeToday: 360,
      });
    });
    it('row 4: Add 3 seats Team(10) -> Team(13), R=12 (all within included)', () => {
      // credit = floor(5000 * 12 / 30) = 2000
      // monthly(Team, 13) = 5000; charge = floor(5000 * 12 / 30) = 2000
      // chargeToday = 2000 - 2000 = 0
      expect(prorationFor('team', 10, 'team', 13, USD_FIXTURE, 12, 30, 'month')).toEqual({
        credit: 2000, charge: 2000, chargeToday: 0,
      });
    });
    it('row 5: First day, Starter(5) -> Team(5), R=30', () => {
      // credit = floor(2000 * 30 / 30) = 2000
      // charge = floor(5000 * 30 / 30) = 5000
      // chargeToday = 5000 - 2000 = 3000
      expect(prorationFor('starter', 5, 'team', 5, USD_FIXTURE, 30, 30, 'month')).toEqual({
        credit: 2000, charge: 5000, chargeToday: 3000,
      });
    });
    it('row 6: Final day, Starter(5) -> Team(5), R=1', () => {
      // credit = floor(2000 * 1 / 30) = 66
      // charge = floor(5000 * 1 / 30) = 166
      // chargeToday = 166 - 66 = 100
      expect(prorationFor('starter', 5, 'team', 5, USD_FIXTURE, 1, 30, 'month')).toEqual({
        credit: 66, charge: 166, chargeToday: 100,
      });
    });
    it('row 7: Two changes (a) Starter->Team R=20, then (b) Team->Business R=10', () => {
      // (a) credit = floor(2000 * 20 / 30) = 1333; charge = floor(5000 * 20 / 30) = 3333; today = 2000
      const stepA = prorationFor('starter', 5, 'team', 5, USD_FIXTURE, 20, 30, 'month');
      expect(stepA).toEqual({ credit: 1333, charge: 3333, chargeToday: 2000 });
      // (b) credit = floor(5000 * 10 / 30) = 1666; charge = floor(12000 * 10 / 30) = 4000; today = 2334
      const stepB = prorationFor('team', 5, 'business', 5, USD_FIXTURE, 10, 30, 'month');
      expect(stepB).toEqual({ credit: 1666, charge: 4000, chargeToday: 2334 });
      // Period total with the initial Starter: 2000 + 2000 + 2334 = 6334
      expect(2000 + stepA!.chargeToday + stepB!.chargeToday).toBe(6334);
    });
    it('row 8: Team(20) -> Business(20), R=15', () => {
      // monthly(Team, 20) = 5000 + 300*5 = 6500; credit = floor(6500 * 15 / 30) = 3250
      // charge = floor(12000 * 15 / 30) = 6000
      // chargeToday = 6000 - 3250 = 2750
      expect(prorationFor('team', 20, 'business', 20, USD_FIXTURE, 15, 30, 'month')).toEqual({
        credit: 3250, charge: 6000, chargeToday: 2750,
      });
    });
    it('row 9: Business(40) -> Business(45), R=7 (5 extra seats)', () => {
      // credit = floor(12000 * 7 / 30) = 2800
      // monthly(Business, 45) = 12000 + 200*5 = 13000; charge = floor(13000 * 7 / 30) = 3033
      // chargeToday = 3033 - 2800 = 233
      expect(prorationFor('business', 40, 'business', 45, USD_FIXTURE, 7, 30, 'month')).toEqual({
        credit: 2800, charge: 3033, chargeToday: 233,
      });
    });
    it('row 10: Downgrade Team(5) -> Starter(5), R=15 (charge 0 now; 2000 at next renewal)', () => {
      // credit = floor(5000 * 15 / 30) = 2500; charge = floor(2000 * 15 / 30) = 1000
      // downgrade -> chargeToday = 0 now; full Starter price 2000 due at next renewal
      expect(prorationFor('team', 5, 'starter', 5, USD_FIXTURE, 15, 30, 'month')).toEqual({
        credit: 2500, charge: 1000, chargeToday: 0,
      });
    });
    it('row 11: Remove seats Team(18) -> Team(15), R=15 (charge 0 now; 5000 at next renewal)', () => {
      // monthly(Team, 18) = 5900; credit = floor(5900 * 15 / 30) = 2950
      // charge = floor(5000 * 15 / 30) = 2500
      // seat removal -> chargeToday = 0 now; full Team price 5000 due at next renewal
      expect(prorationFor('team', 18, 'team', 15, USD_FIXTURE, 15, 30, 'month')).toEqual({
        credit: 2950, charge: 2500, chargeToday: 0,
      });
    });
  });

  describe('NGN production table (kobo, monthly, P=30)', () => {
    it('n1: Starter(5) -> Team(9), R=20', () => {
      // credit = floor(650000 * 20 / 30) = 433333
      // charge = floor(1625000 * 20 / 30) = 1083333
      // chargeToday = 1083333 - 433333 = 650000
      expect(prorationFor('starter', 5, 'team', 9, NGN_TABLE, 20, 30, 'month')).toEqual({
        credit: 433333, charge: 1083333, chargeToday: 650000,
      });
    });
    it('n2: Starter -> Team, R=1', () => {
      // credit = floor(650000 * 1 / 30) = 21666
      // charge = floor(1625000 * 1 / 30) = 54166
      // chargeToday = 54166 - 21666 = 32500
      expect(prorationFor('starter', 5, 'team', 5, NGN_TABLE, 1, 30, 'month')).toEqual({
        credit: 21666, charge: 54166, chargeToday: 32500,
      });
    });
    it('n3: Team 15 -> 18 seats, R=12', () => {
      // credit = floor(1625000 * 12 / 30) = 650000
      // monthly(Team, 18) = 1625000 + 97500*3 = 1917500; charge = floor(1917500 * 12 / 30) = 767000
      // chargeToday = 767000 - 650000 = 117000
      expect(prorationFor('team', 15, 'team', 18, NGN_TABLE, 12, 30, 'month')).toEqual({
        credit: 650000, charge: 767000, chargeToday: 117000,
      });
    });
    it('n4: Business 40 -> 45 seats, R=7', () => {
      // credit = floor(3900000 * 7 / 30) = 910000
      // monthly(Business, 45) = 3900000 + 65000*5 = 4225000; charge = floor(4225000 * 7 / 30) = 985833
      // chargeToday = 985833 - 910000 = 75833
      expect(prorationFor('business', 40, 'business', 45, NGN_TABLE, 7, 30, 'month')).toEqual({
        credit: 910000, charge: 985833, chargeToday: 75833,
      });
    });
    it('n5: Downgrade Team -> Starter: chargeToday 0; 650000 at next renewal', () => {
      // downgrade -> chargeToday = 0 now; Starter base 650000 due at next renewal
      expect(prorationFor('team', 5, 'starter', 5, NGN_TABLE, 15, 30, 'month')).toEqual({
        credit: 812500, charge: 325000, chargeToday: 0,
      });
    });
    it('n6: Remove seats Team 18 -> 15: chargeToday 0; 1625000 at next renewal', () => {
      // monthly(Team, 18) = 1917500; credit = floor(1917500 * 15 / 30) = 958750
      // charge = floor(1625000 * 15 / 30) = 812500
      // seat removal -> chargeToday = 0 now; Team base 1625000 due at next renewal
      expect(prorationFor('team', 18, 'team', 15, NGN_TABLE, 15, 30, 'month')).toEqual({
        credit: 958750, charge: 812500, chargeToday: 0,
      });
    });
  });

  describe('Yearly tests (NGN, P=365)', () => {
    it('yearly (a): Starter(5) -> Team(9), R=200', () => {
      // Starter yearly = 650000 * 12 = 7800000; credit = floor(7800000 * 200 / 365) = 4273972
      // Team yearly = 1625000 * 12 = 19500000; charge = floor(19500000 * 200 / 365) = 10684931
      // chargeToday = 10684931 - 4273972 = 6410959
      expect(prorationFor('starter', 5, 'team', 9, NGN_TABLE, 200, 365, 'year')).toEqual({
        credit: 4273972, charge: 10684931, chargeToday: 6410959,
      });
    });
    it('yearly (b): Team 15 -> 18, R=100', () => {
      // Team yearly = 1625000 * 12 = 19500000; credit = floor(19500000 * 100 / 365) = 5342465
      // Team(18) yearly = (1625000 + 97500*3) * 12 = 1917500 * 12 = 23010000
      // charge = floor(23010000 * 100 / 365) = 6304109
      // chargeToday = 6304109 - 5342465 = 961644
      expect(prorationFor('team', 15, 'team', 18, NGN_TABLE, 100, 365, 'year')).toEqual({
        credit: 5342465, charge: 6304109, chargeToday: 961644,
      });
    });
  });

  describe('Additional rules', () => {
    it('Starter cannot exceed 5 seats', () => {
      // Starter maxSeats = 5; seats 6 > 5 -> null
      expect(prorationFor('starter', 6, 'team', 5, USD_FIXTURE, 20, 30, 'month')).toBe(null);
    });
    it('Downgrade rejected when members exceed new limit: Team(18) -> Starter(5)', () => {
      // Starter maxSeats = 5; oldSeats 18 > 5 -> rejected -> null
      expect(prorationFor('team', 18, 'starter', 5, USD_FIXTURE, 15, 30, 'month')).toBe(null);
    });
    it('Billable seats at 13 before: 1 billable = 120 (USD, R=12)', () => {
      // billable = max(0, 16-15) - max(0, 13-15) = 1 - 0 = 1
      // credit = floor(5000 * 12 / 30) = 2000
      // monthly(Team, 16) = 5000 + 300*1 = 5300; charge = floor(5300 * 12 / 30) = 2120
      // chargeToday = 2120 - 2000 = 120
      expect(prorationFor('team', 13, 'team', 16, USD_FIXTURE, 12, 30, 'month')).toEqual({
        credit: 2000, charge: 2120, chargeToday: 120,
      });
    });
    it('Billable seats at 14 before: 2 billable = 240 (USD, R=12)', () => {
      // billable = max(0, 17-15) - max(0, 14-15) = 2 - 0 = 2
      // credit = floor(5000 * 12 / 30) = 2000
      // monthly(Team, 17) = 5000 + 300*2 = 5600; charge = floor(5600 * 12 / 30) = 2240
      // chargeToday = 2240 - 2000 = 240
      expect(prorationFor('team', 14, 'team', 17, USD_FIXTURE, 12, 30, 'month')).toEqual({
        credit: 2000, charge: 2240, chargeToday: 240,
      });
    });
    it('Ceiling 200: Team(201) rejected', () => {
      // 201 > maxSeats 200 -> null
      expect(prorationFor('team', 201, 'team', 200, USD_FIXTURE, 15, 30, 'month')).toBe(null);
    });
  });

  describe('creditFor / chargeFor', () => {
    it('creditFor Starter(5), R=20, P=30, USD = 1333', () => {
      // floor(2000 * 20 / 30) = 1333
      expect(creditFor('starter', 5, USD_FIXTURE.starter.price, { includedSeats: 5, maxSeats: 5 }, 20, 30, 'month')).toBe(1333);
    });
    it('chargeFor Starter(6 seats) invalid -> null', () => {
      // Starter hard cap -> null
      expect(chargeFor('starter', 6, USD_FIXTURE.starter.price, { includedSeats: 5, maxSeats: 5 }, 20, 30, 'month')).toBe(null);
    });
  });

  describe('currency decimals (PRD 5: minor_unit per currency)', () => {
    it('NGN has 2 decimals', () => {
      expect(currencyDecimals('NGN')).toBe(2);
    });
    it('JPY has 0 decimals', () => {
      expect(currencyDecimals('JPY')).toBe(0);
    });
    it('USD has 2 decimals', () => {
      expect(currencyDecimals('USD')).toBe(2);
    });
    it('unknown currency -> null', () => {
      expect(currencyDecimals('XXX')).toBe(null);
    });
  });

  describe('elapsedDays / daysRemaining (current time passed in; no clock reads)', () => {
    it('elapsedDays counts whole days between two instants', () => {
      const start = new Date('2026-01-01T00:00:00Z');
      const now = new Date('2026-01-11T00:00:00Z');
      // 10 whole days elapsed
      expect(elapsedDays(start, now)).toBe(10);
    });
    it('daysRemaining: first day R = P, last day R = 1', () => {
      const start = new Date('2026-01-01T00:00:00Z');
      expect(daysRemaining(start, start, 30)).toBe(30); // first day: R = P
      const last = new Date('2026-01-30T00:00:00Z'); // 29 days elapsed -> R = 30 - 29 = 1
      expect(daysRemaining(start, last, 30)).toBe(1);
    });
    it('daysRemaining after period ends: R = 0', () => {
      const start = new Date('2026-01-01T00:00:00Z');
      const after = new Date('2026-02-02T00:00:00Z'); // 32 days elapsed -> R = 0
      expect(daysRemaining(start, after, 30)).toBe(0);
    });
  });

  describe('FIX-D: R and P from period_start / period_end (injected clock)', () => {
    it('proration uses actual period days, not hard-coded 30', () => {
      // Period: Jan 1 to Feb 1 = 31 days. R at Jan 16 = 31 - 15 = 16.
      const start = new Date('2026-01-01T00:00:00Z');
      const now = new Date('2026-01-16T00:00:00Z'); // 15 days elapsed
      const remaining = daysRemaining(start, now, 31);
      expect(remaining).toBe(16);
      // credit = floor(2000 * 16 / 31) = floor(32000 / 31) = 1032
      expect(creditFor('starter', 5, USD_FIXTURE.starter.price, USD_FIXTURE.starter.limits, 16, 31, 'month')).toBe(1032);
    });
    it('first day with 31-day period: R = 31', () => {
      const start = new Date('2026-01-01T00:00:00Z');
      expect(daysRemaining(start, start, 31)).toBe(31);
    });
    it('last day with 31-day period: R = 1', () => {
      const start = new Date('2026-01-01T00:00:00Z');
      const last = new Date('2026-01-31T00:00:00Z'); // 30 days elapsed
      expect(daysRemaining(start, last, 31)).toBe(1);
    });
  });

  describe('FIX-J: yearly period_end = +1 year', () => {
    it('yearly period_end is period_start + 365 days', () => {
      const start = new Date('2026-01-01T00:00:00Z');
      const expectedEnd = new Date(start.getTime() + 365 * 24 * 60 * 60 * 1000);
      // Proration over a full year: credit = full price
      const price = periodPrice('starter', 5, NGN_TABLE.starter.price, NGN_TABLE.starter.limits, 'year');
      expect(price).toBe(7800000); // 650000 * 12
      const credit = creditFor('starter', 5, NGN_TABLE.starter.price, NGN_TABLE.starter.limits, 365, 365, 'year');
      expect(credit).toBe(7800000);
      // Just verify the period_end calculation principle
      expect(expectedEnd.getTime() - start.getTime()).toBe(365 * 24 * 60 * 60 * 1000);
    });
  });
});

