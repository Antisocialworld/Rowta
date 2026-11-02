// Pure unit tests for the quiet-hours delivery engine (PRD 8.7, 8.8, 8.11; rules C9, J4).
// Zero I/O, zero database, zero Redis; all instants are fixed UTC timestamps (new Date('...Z')).
import { describe, expect, it } from 'vitest';
import {
  decideDelivery,
  InvalidTimeZoneError,
  isValidTimeZone,
  parseQuietTime,
} from '../src/notifications/quiet-hours.ts';

describe('quiet-hours engine', () => {
  describe('isValidTimeZone', () => {
    it('accepts valid IANA time zone identifiers', () => {
      expect(isValidTimeZone('Africa/Lagos')).toBe(true);
      expect(isValidTimeZone('America/New_York')).toBe(true);
      expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
      expect(isValidTimeZone('Pacific/Chatham')).toBe(true);
      expect(isValidTimeZone('Europe/London')).toBe(true);
      expect(isValidTimeZone('UTC')).toBe(true);
    });

    it('rejects invalid or empty time zone strings', () => {
      expect(isValidTimeZone('')).toBe(false);
      expect(isValidTimeZone('   ')).toBe(false);
      expect(isValidTimeZone('Invalid/Timezone')).toBe(false);
      expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    });
  });

  describe('parseQuietTime', () => {
    it('parses valid HH:MM and HH:MM:SS strings into minutes after midnight', () => {
      expect(parseQuietTime('00:00')).toBe(0);
      expect(parseQuietTime('06:00')).toBe(360);
      expect(parseQuietTime('06:00:00')).toBe(360);
      expect(parseQuietTime('13:30')).toBe(810);
      expect(parseQuietTime('13:30:45')).toBe(810);
      expect(parseQuietTime('22:00')).toBe(1320);
      expect(parseQuietTime('23:59')).toBe(1439);
      expect(parseQuietTime('23:59:59')).toBe(1439);
    });

    it('returns null for malformed or out-of-range times', () => {
      expect(parseQuietTime('bad')).toBe(null);
      expect(parseQuietTime('24:00')).toBe(null);
      expect(parseQuietTime('12:60')).toBe(null);
      expect(parseQuietTime('12:00:60')).toBe(null);
      expect(parseQuietTime('1:00')).toBe(null);
      expect(parseQuietTime('')).toBe(null);
      expect(parseQuietTime(null)).toBe(null);
      expect(parseQuietTime(undefined)).toBe(null);
    });
  });

  describe('decideDelivery: PRD baseline case', () => {
    it('delays a notification at 02:00 Africa/Lagos with quiet hours 22:00 to 06:00 until 06:00 local', () => {
      // Africa/Lagos is UTC+1 year-round (WAT, no DST).
      // 02:00 local on 2026-06-15 is 01:00:00 UTC.
      const now = new Date('2026-06-15T01:00:00.000Z');
      const decision = decideDelivery({
        now,
        timeZone: 'Africa/Lagos',
        quietStart: '22:00',
        quietEnd: '06:00',
        urgent: false,
      });

      expect(decision.action).toBe('delay');
      if (decision.action === 'delay') {
        // 06:00 local that morning is 05:00:00 UTC
        expect(decision.deliverAt.toISOString()).toBe('2026-06-15T05:00:00.000Z');
        expect(decision.delayMs).toBe(4 * 3600 * 1000);
        expect(decision.deliverAt.getTime()).toBeGreaterThan(now.getTime());
      }
    });
  });

  describe('decideDelivery: window boundaries [start, end)', () => {
    it('delays at exactly start time (22:00)', () => {
      // 22:00 WAT on 2026-06-15 is 21:00:00 UTC
      const now = new Date('2026-06-15T21:00:00.000Z');
      const decision = decideDelivery({
        now,
        timeZone: 'Africa/Lagos',
        quietStart: '22:00',
        quietEnd: '06:00',
        urgent: false,
      });

      expect(decision.action).toBe('delay');
      if (decision.action === 'delay') {
        // Delivers at next morning 06:00 WAT (05:00 UTC on 2026-06-16)
        expect(decision.deliverAt.toISOString()).toBe('2026-06-16T05:00:00.000Z');
        expect(decision.delayMs).toBe(8 * 3600 * 1000);
      }
    });

    it('sends immediately one minute before start time (21:59)', () => {
      // 21:59 WAT on 2026-06-15 is 20:59:00 UTC
      const now = new Date('2026-06-15T20:59:00.000Z');
      const decision = decideDelivery({
        now,
        timeZone: 'Africa/Lagos',
        quietStart: '22:00',
        quietEnd: '06:00',
        urgent: false,
      });

      expect(decision).toEqual({ action: 'send' });
    });

    it('sends immediately at exactly end time (06:00)', () => {
      // 06:00 WAT on 2026-06-15 is 05:00:00 UTC
      const now = new Date('2026-06-15T05:00:00.000Z');
      const decision = decideDelivery({
        now,
        timeZone: 'Africa/Lagos',
        quietStart: '22:00',
        quietEnd: '06:00',
        urgent: false,
      });

      expect(decision).toEqual({ action: 'send' });
    });

    it('delays one minute before end time (05:59)', () => {
      // 05:59 WAT on 2026-06-15 is 04:59:00 UTC
      const now = new Date('2026-06-15T04:59:00.000Z');
      const decision = decideDelivery({
        now,
        timeZone: 'Africa/Lagos',
        quietStart: '22:00',
        quietEnd: '06:00',
        urgent: false,
      });

      expect(decision.action).toBe('delay');
      if (decision.action === 'delay') {
        expect(decision.deliverAt.toISOString()).toBe('2026-06-15T05:00:00.000Z');
        expect(decision.delayMs).toBe(60 * 1000);
      }
    });
  });

  describe('decideDelivery: same-day window (13:00 to 15:00)', () => {
    it('sends before start (12:59 local)', () => {
      // 12:59 WAT is 11:59:00 UTC
      const now = new Date('2026-06-15T11:59:00.000Z');
      const decision = decideDelivery({
        now,
        timeZone: 'Africa/Lagos',
        quietStart: '13:00',
        quietEnd: '15:00',
        urgent: false,
      });
      expect(decision).toEqual({ action: 'send' });
    });

    it('delays inside the window (13:00 local)', () => {
      // 13:00 WAT is 12:00:00 UTC
      const now = new Date('2026-06-15T12:00:00.000Z');
      const decision = decideDelivery({
        now,
        timeZone: 'Africa/Lagos',
        quietStart: '13:00',
        quietEnd: '15:00',
        urgent: false,
      });
      expect(decision.action).toBe('delay');
      if (decision.action === 'delay') {
        expect(decision.deliverAt.toISOString()).toBe('2026-06-15T14:00:00.000Z');
        expect(decision.delayMs).toBe(2 * 3600 * 1000);
      }
    });

    it('sends at exactly end time (15:00 local)', () => {
      // 15:00 WAT is 14:00:00 UTC
      const now = new Date('2026-06-15T14:00:00.000Z');
      const decision = decideDelivery({
        now,
        timeZone: 'Africa/Lagos',
        quietStart: '13:00',
        quietEnd: '15:00',
        urgent: false,
      });
      expect(decision).toEqual({ action: 'send' });
    });

    it('sends after end time (15:01 local)', () => {
      // 15:01 WAT is 14:01:00 UTC
      const now = new Date('2026-06-15T14:01:00.000Z');
      const decision = decideDelivery({
        now,
        timeZone: 'Africa/Lagos',
        quietStart: '13:00',
        quietEnd: '15:00',
        urgent: false,
      });
      expect(decision).toEqual({ action: 'send' });
    });
  });

  describe('decideDelivery: same instant in different time zones', () => {
    it('produces send in Lagos and delay in New York for the identical UTC instant', () => {
      // Instant: 2026-06-15T08:00:00.000Z
      // In Africa/Lagos (UTC+1): 09:00:00 local (daytime -> send)
      // In America/New_York (UTC-4, EDT): 04:00:00 local (inside 22:00 to 06:00 -> delay)
      const now = new Date('2026-06-15T08:00:00.000Z');
      const quiet = { quietStart: '22:00', quietEnd: '06:00', urgent: false };

      const lagosDecision = decideDelivery({ now, timeZone: 'Africa/Lagos', ...quiet });
      const nyDecision = decideDelivery({ now, timeZone: 'America/New_York', ...quiet });

      expect(lagosDecision).toEqual({ action: 'send' });
      expect(nyDecision.action).toBe('delay');
      if (nyDecision.action === 'delay') {
        // 06:00 EDT on 2026-06-15 is 10:00:00 UTC
        expect(nyDecision.deliverAt.toISOString()).toBe('2026-06-15T10:00:00.000Z');
        expect(nyDecision.delayMs).toBe(2 * 3600 * 1000);
      }
    });
  });

  describe('decideDelivery: fractional offset time zones', () => {
    it('handles Asia/Kolkata (UTC+05:30)', () => {
      // In Kolkata, 02:00 local on 2026-06-15 is 2026-06-14T20:30:00.000Z
      const now = new Date('2026-06-14T20:30:00.000Z');
      const decision = decideDelivery({
        now,
        timeZone: 'Asia/Kolkata',
        quietStart: '22:00',
        quietEnd: '06:00',
        urgent: false,
      });

      expect(decision.action).toBe('delay');
      if (decision.action === 'delay') {
        // 06:00 local is 2026-06-15T00:30:00.000Z
        expect(decision.deliverAt.toISOString()).toBe('2026-06-15T00:30:00.000Z');
        expect(decision.delayMs).toBe(4 * 3600 * 1000);
      }
    });

    it('handles Pacific/Chatham (UTC+12:45 standard time)', () => {
      // In July, Chatham is in standard time (UTC+12:45).
      // 02:00 local on 2026-07-15 is 2026-07-14T13:15:00.000Z
      const now = new Date('2026-07-14T13:15:00.000Z');
      const decision = decideDelivery({
        now,
        timeZone: 'Pacific/Chatham',
        quietStart: '22:00',
        quietEnd: '06:00',
        urgent: false,
      });

      expect(decision.action).toBe('delay');
      if (decision.action === 'delay') {
        // 06:00 local on 2026-07-15 is 2026-07-14T17:15:00.000Z
        expect(decision.deliverAt.toISOString()).toBe('2026-07-14T17:15:00.000Z');
        expect(decision.delayMs).toBe(4 * 3600 * 1000);
      }
    });
  });

  describe('decideDelivery: Daylight Saving Time edge cases', () => {
    it('handles America/New_York spring-forward gap on 2027-03-14 when end falls in the skipped hour', () => {
      // In New York on 2027-03-14, 02:00:00 jumps directly to 03:00:00 EDT.
      // Quiet window: 22:00 to 02:30.
      // 02:30 does not exist. Rule 3e: deliver at first real instant at or after the gap ends (03:00 EDT = 07:00:00 UTC).
      // Evaluation at 23:00 EST on 2027-03-13 (2027-03-14T04:00:00.000Z):
      const now = new Date('2027-03-14T04:00:00.000Z');
      const decision = decideDelivery({
        now,
        timeZone: 'America/New_York',
        quietStart: '22:00',
        quietEnd: '02:30',
        urgent: false,
      });

      expect(decision.action).toBe('delay');
      if (decision.action === 'delay') {
        expect(decision.deliverAt.toISOString()).toBe('2027-03-14T07:00:00.000Z');
        expect(decision.delayMs).toBe(3 * 3600 * 1000);
      }
    });

    it('handles America/New_York fall-back overlap on 2026-11-01 during first and second occurrence', () => {
      // In New York on 2026-11-01, 01:00 to 02:00 occurs twice:
      // First occurrence: 05:00:00Z to 06:00:00Z (EDT, UTC-4) -> 01:30 is 05:30:00Z.
      // Second occurrence: 06:00:00Z to 07:00:00Z (EST, UTC-5) -> 01:30 is 06:30:00Z.
      // Quiet window: 22:00 to 01:30.

      // Subcase 1: now during first occurrence before first 01:30 (01:15 EDT = 05:15:00Z)
      const now1 = new Date('2026-11-01T05:15:00.000Z');
      const decision1 = decideDelivery({
        now: now1,
        timeZone: 'America/New_York',
        quietStart: '22:00',
        quietEnd: '01:30',
        urgent: false,
      });
      expect(decision1.action).toBe('delay');
      if (decision1.action === 'delay') {
        expect(decision1.deliverAt.toISOString()).toBe('2026-11-01T05:30:00.000Z');
        expect(decision1.delayMs).toBe(15 * 60 * 1000);
      }

      // Subcase 2: now during first occurrence after first 01:30 (01:45 EDT = 05:45:00Z)
      // The first 01:30 has passed; the next strictly future occurrence is the second 01:30 (06:30:00Z).
      const now2 = new Date('2026-11-01T05:45:00.000Z');
      const decision2 = decideDelivery({
        now: now2,
        timeZone: 'America/New_York',
        quietStart: '22:00',
        quietEnd: '01:30',
        urgent: false,
      });
      expect(decision2.action).toBe('delay');
      if (decision2.action === 'delay') {
        expect(decision2.deliverAt.toISOString()).toBe('2026-11-01T06:30:00.000Z');
        expect(decision2.delayMs).toBe(45 * 60 * 1000);
      }

      // Subcase 3: now during second occurrence before second 01:30 (01:15 EST = 06:15:00Z)
      const now3 = new Date('2026-11-01T06:15:00.000Z');
      const decision3 = decideDelivery({
        now: now3,
        timeZone: 'America/New_York',
        quietStart: '22:00',
        quietEnd: '01:30',
        urgent: false,
      });
      expect(decision3.action).toBe('delay');
      if (decision3.action === 'delay') {
        expect(decision3.deliverAt.toISOString()).toBe('2026-11-01T06:30:00.000Z');
        expect(decision3.delayMs).toBe(15 * 60 * 1000);
      }
    });

    it('handles Europe/London across both 2027 DST transitions', () => {
      // 1. London Spring Forward on 2027-03-28: clocks jump from 01:00:00 GMT to 02:00:00 BST.
      // Quiet window: 22:00 to 01:30.
      // 01:30 does not exist; gap ends at 02:00 BST = 2027-03-28T01:00:00.000Z.
      const springNow = new Date('2027-03-27T23:00:00.000Z'); // 23:00 GMT
      const springDecision = decideDelivery({
        now: springNow,
        timeZone: 'Europe/London',
        quietStart: '22:00',
        quietEnd: '01:30',
        urgent: false,
      });
      expect(springDecision.action).toBe('delay');
      if (springDecision.action === 'delay') {
        expect(springDecision.deliverAt.toISOString()).toBe('2027-03-28T01:00:00.000Z');
        expect(springDecision.delayMs).toBe(2 * 3600 * 1000);
      }

      // 2. London Fall Back on 2027-10-31: clocks jump from 02:00:00 BST back to 01:00:00 GMT.
      // First 01:30 occurs at 00:30:00 UTC (BST). Second occurs at 01:30:00 UTC (GMT).
      const fallNow = new Date('2027-10-31T00:15:00.000Z'); // 01:15 BST
      const fallDecision = decideDelivery({
        now: fallNow,
        timeZone: 'Europe/London',
        quietStart: '22:00',
        quietEnd: '01:30',
        urgent: false,
      });
      expect(fallDecision.action).toBe('delay');
      if (fallDecision.action === 'delay') {
        expect(fallDecision.deliverAt.toISOString()).toBe('2027-10-31T00:30:00.000Z');
        expect(fallDecision.delayMs).toBe(15 * 60 * 1000);
      }
    });
  });

  describe('decideDelivery: edge cases, bypasses, and validation', () => {
    const fixedNow = new Date('2026-06-15T01:00:00.000Z');

    it('sends immediately when quietStart equals quietEnd (Rule 3b recorded decision)', () => {
      const decision = decideDelivery({
        now: fixedNow,
        timeZone: 'Africa/Lagos',
        quietStart: '22:00',
        quietEnd: '22:00',
        urgent: false,
      });
      expect(decision).toEqual({ action: 'send' });
    });

    it('sends immediately when either quiet value is null (Rule 3a)', () => {
      expect(
        decideDelivery({
          now: fixedNow,
          timeZone: 'Africa/Lagos',
          quietStart: null,
          quietEnd: '06:00',
          urgent: false,
        }),
      ).toEqual({ action: 'send' });

      expect(
        decideDelivery({
          now: fixedNow,
          timeZone: 'Africa/Lagos',
          quietStart: '22:00',
          quietEnd: null,
          urgent: false,
        }),
      ).toEqual({ action: 'send' });

      expect(
        decideDelivery({
          now: fixedNow,
          timeZone: 'Africa/Lagos',
          quietStart: null,
          quietEnd: null,
          urgent: false,
        }),
      ).toEqual({ action: 'send' });
    });

    it('sends immediately when urgent is true even if within quiet hours (Rule 3a)', () => {
      const decision = decideDelivery({
        now: fixedNow, // 02:00 WAT, inside 22:00 to 06:00
        timeZone: 'Africa/Lagos',
        quietStart: '22:00',
        quietEnd: '06:00',
        urgent: true,
      });
      expect(decision).toEqual({ action: 'send' });
    });

    it('throws InvalidTimeZoneError for unknown IANA time zones', () => {
      expect(() =>
        decideDelivery({
          now: fixedNow,
          timeZone: 'Atlantis/Sunken_City',
          quietStart: '22:00',
          quietEnd: '06:00',
          urgent: false,
        }),
      ).toThrow(InvalidTimeZoneError);
    });

    it('sends immediately when quiet time format is malformed', () => {
      const decision = decideDelivery({
        now: fixedNow,
        timeZone: 'Africa/Lagos',
        quietStart: 'invalid',
        quietEnd: '06:00',
        urgent: false,
      });
      expect(decision).toEqual({ action: 'send' });
    });

    it('ensures delayMs is always > 0 and deliverAt is always > now for every delay case', () => {
      const cases = [
        { now: new Date('2026-06-15T01:00:00.000Z'), tz: 'Africa/Lagos', s: '22:00', e: '06:00' },
        { now: new Date('2026-06-15T21:00:00.000Z'), tz: 'Africa/Lagos', s: '22:00', e: '06:00' },
        { now: new Date('2026-06-15T12:00:00.000Z'), tz: 'Africa/Lagos', s: '13:00', e: '15:00' },
        { now: new Date('2026-11-01T05:15:00.000Z'), tz: 'America/New_York', s: '22:00', e: '01:30' },
        { now: new Date('2027-03-14T04:00:00.000Z'), tz: 'America/New_York', s: '22:00', e: '02:30' },
      ];

      for (const c of cases) {
        const decision = decideDelivery({
          now: c.now,
          timeZone: c.tz,
          quietStart: c.s,
          quietEnd: c.e,
          urgent: false,
        });

        expect(decision.action).toBe('delay');
        if (decision.action === 'delay') {
          expect(decision.delayMs).toBeGreaterThan(0);
          expect(Number.isInteger(decision.delayMs)).toBe(true);
          expect(decision.deliverAt.getTime()).toBeGreaterThan(c.now.getTime());
          expect(decision.delayMs).toBe(decision.deliverAt.getTime() - c.now.getTime());
        }
      }
    });
  });
});

