// QuoteScreen — price preview BEFORE anything is charged (D3).
// Shows the server-computed price (kobo → naira, integer formatting) for an account-level action
// and lets the owner confirm and pay (checkout) or decline. Every amount comes from the server;
// no floats, no client-computed prices.
import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, TextInstance, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BillingBackButton, Button, Card, Skeleton, Text as BText } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { ApiError, errorMessageKey } from '../../lib/api';
import { billingApi } from '../../api/billing';
import { formatMinorToNaira } from '../../lib/money-format';
import { useBilling, type QuoteAction, type QuoteParams } from '../../state/billing';
import { useTeamsView } from '../../state/teams-view';
import { TeamScreenLayout } from '../teams/TeamScreenLayout';
import { typeStyle } from '../../theme/fonts';
import { spacing } from '../../theme/tokens';

export type QuoteScreenProps = {
  readonly onBack?: () => void;
};

export function QuoteScreen({ onBack }: QuoteScreenProps = {}) {
  const headingRef = useRef<TextInstance>(null);
  const { setLoading, error, setError, ensureKey, quoteParams, clearQuoteParams } = useBilling();
  const teamsViewGo = useTeamsView((state) => state.go);
  const teamsViewBack = useTeamsView((state) => state.back);
  const handleBack = onBack ?? teamsViewBack;
  const queryClient = useQueryClient();

  const accountQuery = useQuery({
    queryKey: ['billing', 'account'],
    queryFn: () => billingApi.accountStatus(),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const params: QuoteParams =
    quoteParams ?? { action: 'subscribe', interval: 'monthly', teamId: undefined, people: undefined };
  const { action, interval, teamId, people } = params;
  const accountPlan = accountQuery.data?.account?.plan ?? null;
  const resolvedInterval: 'monthly' | 'yearly' = interval ?? (accountPlan === 'yearly' ? 'yearly' : 'monthly');

  const intervalKey: Record<'monthly' | 'yearly', MessageKey> = {
    monthly: 'billing.interval.month',
    yearly: 'billing.interval.year',
  };
  const actionLabelKey: Record<QuoteAction, MessageKey> = {
    subscribe: 'billing.account.subscribe',
    add_team: 'billing.quote.addTeam',
    add_people: 'billing.quote.addPeople',
    switch_interval: 'billing.account.switchInterval',
  };

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (accountQuery.data?.account) {
      setLoading(false);
    }
  }, [accountQuery.data, setLoading]);

  useEffect(() => {
    clearQuoteParams();
  }, [clearQuoteParams]);

  const quoteQuery = useQuery({
    queryKey: ['billing', 'quote', action, resolvedInterval, teamId, people],
    queryFn: async () => {
      const input: { action: QuoteAction; interval?: 'monthly' | 'yearly'; teamId?: string; people?: number } = {
        action,
        interval: resolvedInterval,
      };
      if (action === 'add_team' || action === 'add_people') {
        input.teamId = teamId ?? undefined;
      }
      if (action === 'add_people' && people !== undefined) {
        input.people = people;
      }
      return billingApi.quote(input);
    },
    enabled: action === 'subscribe' || action === 'switch_interval' || teamId !== undefined,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  let quote: { amountMinor: number; currency: string; description: string; effectiveFrom: 'now' | 'next_renewal' } | null = null;
  if (quoteQuery.data) {
    quote = {
      amountMinor: quoteQuery.data.amountMinor,
      currency: quoteQuery.data.currency,
      description: quoteQuery.data.description,
      effectiveFrom: quoteQuery.data.effectiveFrom,
    };
  }

  const handleConfirm = async () => {
    if (!quote) return;
    setBusy(true);
    try {
      const key = ensureKey('checkout');
      const result = await billingApi.checkout(
        { action, interval, teamId: teamId ?? undefined, people },
        key,
      );
      if (__DEV__) {
        const base = process.env.EXPO_PUBLIC_API_URL;
        if (!base || base.trim() === '') {
          throw new Error('billing.simulatorUnavailable');
        }
        const cleanBase = base.replace(/\/+$/, '');
        await fetch(`${cleanBase}/simulator/checkout/${encodeURIComponent(result.txRef)}`);
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          const acc = await billingApi.accountStatus();
          if (acc.account?.status === 'active') break;
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
        await queryClient.invalidateQueries({ queryKey: ['billing', 'account'] });
        await queryClient.invalidateQueries({ queryKey: ['teams', 'list'] });
        teamsViewGo('billing', 'billing.account.subscribed');
        return;
      }
      void Linking.openURL(result.checkoutUrl);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(t(errorMessageKey(err.code)));
      } else {
        setError(t('billing.error.generic'));
      }
    } finally {
      setBusy(false);
    }
  };

  if (accountQuery.isLoading || quoteQuery.isLoading) {
    return (
      <TeamScreenLayout testID="quote-screen">
        <Skeleton variant="block" style={[styles.skeleton, { height: 500 }]} />
      </TeamScreenLayout>
    );
  }

  const priceText = quote ? formatMinorToNaira(quote.amountMinor, quote.currency) : '-';

  return (
    <TeamScreenLayout testID="quote-screen">
      <View style={styles.headerRow}>
        <BText ref={headingRef} variant="headline-small" style={styles.heading} accessibilityRole="header">
          {t('billing.quote.title')}
        </BText>
        <BillingBackButton onPress={handleBack} testID="quote-back" accessibilityRole="button" />
      </View>

      <View style={styles.actionCard}>
        <BText variant="title-medium">{t('billing.account.plan')}</BText>
        <BText variant="body-large">{t(intervalKey[resolvedInterval])}</BText>
        <BText variant="body-small" tone="secondary">{t(actionLabelKey[action])}</BText>
      </View>

      <View style={styles.priceCard}>
        <BText variant="title-medium">{t('billing.quote.amount')}</BText>
        <BText variant="body-large">{priceText}</BText>
        <BText variant="body-small" tone="secondary">
          {quote?.effectiveFrom === 'next_renewal'
            ? t('billing.quote.effectiveNextRenewal')
            : t('billing.quote.effectiveNow')}
        </BText>
      </View>

      <View style={styles.actions}>
        <Button
          label="billing.quote.notNow"
          variant="ghost"
          onPress={handleBack}
          testID="quote-not-now"
        />
        <Button
          label="billing.quote.confirmAndPay"
          variant="primary"
          busy={busy}
          onPress={() => {
            void handleConfirm();
          }}
          testID="quote-confirm-pay"
        />
      </View>
      {error ? (
        <Card variant="flat" style={styles.errorCard}>
          <BText variant="body-medium" tone="error">{error}</BText>
        </Card>
      ) : null}
    </TeamScreenLayout>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: typeStyle('headline-small').fontSize, marginBottom: spacing.small },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.base },
  actionCard: { flex: 1, minWidth: 140, marginBottom: spacing.base },
  priceCard: { flex: 1, minWidth: 140, marginBottom: spacing.base },
  actions: { gap: spacing.small, marginTop: spacing.base },
  errorCard: { marginBottom: spacing.base },
  skeleton: { width: '100%', alignSelf: 'center' },
});
