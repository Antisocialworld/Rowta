// Money conversion tests (Task 3).
// Pure unit tests for server/src/billing/money.ts. Imports ONLY from that module.
// Expected values are hand-computed literals (never computed by calling the formula).
// Provider unit: NGN = 'major' (naira, confirmed per owner 6 Nov 2026); zero-decimal
// currencies stay 'minor'. [VERIFY] NGN unit must be confirmed once in the Flutterwave sandbox.
import { describe, expect, it } from 'vitest';
import {
  currencyConfig,
  fromProviderAmount,
  toProviderAmount,
  type CurrencyConfig,
} from '../src/billing/money.ts';

const NGN: CurrencyConfig = { code: 'NGN', minorUnit: 2, providerUnit: 'major' };
const JPY: CurrencyConfig = { code: 'JPY', minorUnit: 0, providerUnit: 'minor' };
const KWD: CurrencyConfig = { code: 'KWD', minorUnit: 3, providerUnit: 'minor' };

describe('billing money (provider unit [VERIFY])', () => {
  describe('currencyConfig', () => {
    it('NGN config: minorUnit 2, providerUnit major', () => {
      expect(currencyConfig('NGN')).toEqual(NGN);
    });
    it('JPY config: minorUnit 0, providerUnit minor', () => {
      expect(currencyConfig('JPY')).toEqual(JPY);
    });
    it('KWD config: minorUnit 3, providerUnit minor', () => {
      expect(currencyConfig('KWD')).toEqual(KWD);
    });
    it('unknown currency -> null', () => {
      expect(currencyConfig('XXX')).toBe(null);
    });
    it('currency code is case-insensitive', () => {
      expect(currencyConfig('ngn')).toEqual(NGN);
    });
  });

  describe('toProviderAmount: minor units -> provider units', () => {
    it('major-unit currency: 650000 kobo -> 6500 naira (NGN, 2 decimals)', () => {
      // providerUnit === 'major': divide by 10^minorUnit
      expect(toProviderAmount(650000, 'NGN')).toBe(6500);
    });
    it('major-unit currency: 0 kobo -> 0 naira', () => {
      expect(toProviderAmount(0, 'NGN')).toBe(0);
    });
    it('zero-decimal currency: 1000 yen -> 1000 (JPY, 0 decimals)', () => {
      // providerUnit === 'minor', minorUnit === 0: no change
      expect(toProviderAmount(1000, 'JPY')).toBe(1000);
    });
    it('three-decimal currency: 1234560 fils -> 1234560 (KWD, 3 decimals)', () => {
      // providerUnit === 'minor': no change
      expect(toProviderAmount(1234560, 'KWD')).toBe(1234560);
    });
    it('unknown currency -> null', () => {
      expect(toProviderAmount(100, 'XXX')).toBe(null);
    });
    it('non-integer minor throws', () => {
      expect(() => toProviderAmount(100.5, 'NGN')).toThrow();
    });
  });

  describe('fromProviderAmount: provider units -> minor units', () => {
    it('major-unit currency: 6500 naira -> 650000 kobo (NGN, 2 decimals)', () => {
      // providerUnit === 'major': multiply by 10^minorUnit
      expect(fromProviderAmount(6500, 'NGN')).toBe(650000);
    });
    it('zero-decimal currency: 1000 -> 1000 (JPY, 0 decimals)', () => {
      expect(fromProviderAmount(1000, 'JPY')).toBe(1000);
    });
    it('unknown currency -> null', () => {
      expect(fromProviderAmount(100, 'XXX')).toBe(null);
    });
    it('major-unit provider amount converts with decimals: 100.5 NGN -> 10050 kobo', () => {
      expect(fromProviderAmount(100.5, 'NGN')).toBe(10050);
    });
    it('major-unit provider amount with more than 2 decimals throws', () => {
      expect(() => fromProviderAmount(100.555, 'NGN')).toThrow();
    });
    it('non-integer provider amount on minor currency throws', () => {
      expect(() => fromProviderAmount(100.5, 'JPY')).toThrow();
    });
  });

  describe('round-trip consistency', () => {
    it('toProviderAmount then fromProviderAmount returns the original (major currency)', () => {
      const original = 1625000;
      const provider = toProviderAmount(original, 'NGN');
      if (provider === null) throw new Error('toProviderAmount returned null');
      expect(provider).toBe(16250);
      expect(fromProviderAmount(provider, 'NGN')).toBe(original);
    });
    it('toProviderAmount then fromProviderAmount returns the original (zero-decimal currency)', () => {
      const original = 1000;
      const provider = toProviderAmount(original, 'JPY');
      if (provider === null) throw new Error('toProviderAmount returned null');
      expect(provider).toBe(original);
      expect(fromProviderAmount(provider, 'JPY')).toBe(original);
    });
  });
});
