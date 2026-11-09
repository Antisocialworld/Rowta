// Billing screen (D3, account-level).
// Shows account status, plan, interval, trial days left, next renewal, teams coverage and
// actions (subscribe, switch interval, cancel at period end, move billing). Quote screen opens before
// paying. Every price comes from the server in kobo, formatted with the integer money-format (no
// floats). Accessibility labels on every button (X1); no amounts in notification payloads (rule S9).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInstance, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { BillingBackButton, Button, Card, ConfirmDialog, EmptyState, Skeleton, Text as BText } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { ApiError, errorMessageKey, teamsApi } from '../../lib/api';
import { billingApi } from '../../api/billing';
import { formatMinorToNaira } from '../../lib/money-format';
import { formatDisplayDate } from '../../lib/shift-time';
import { useBilling } from '../../state/billing';
import { useTeams } from '../../state/teams';
import { useTeamsView } from '../../state/teams-view';
import { TeamScreenLayout } from '../teams/TeamScreenLayout';
import { QuoteScreen } from './QuoteScreen';
import { typeStyle } from '../../theme/fonts';
import { spacing } from '../../theme/tokens';

export type BillingView = 'account' | 'quote';

export function BillingScreen() {
  const headingRef = useRef<TextInstance>(null);
  const {
    account,
    entitlements,
    setAccount,
    setEntitlements,
    error,
    setError,
    ensureKey,
    clearKey,
    setQuoteParams,
  } = useBilling();
  const [view, setView] = useState<BillingView>('account');
  const [busy, setBusy] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [resumeConfirm, setResumeConfirm] = useState(false);

  const accountQuery = useQuery({
    queryKey: ['billing', 'account'],
    queryFn: () => billingApi.accountStatus(),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const teamsQuery = useQuery({
    queryKey: ['teams', 'list'],
    queryFn: () => teamsApi.listTeams(),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const teamsViewGo = useTeamsView((state) => state.go);
  const teamsViewBack = useTeamsView((state) => state.back);
  const teamsViewMessage = useTeamsView((state) => state.message);
  const selectTeamId = useTeams((state) => state.setSelectedTeamId);

  // G1-1: Find teams where the signed-in user is the payer (owner_team_registry.owner_user_id).
  const currentUserId = accountQuery.data?.account?.userId ?? null;
  const payerTeams = teamsQuery.data?.teams.filter((t) => t.payerUserId === currentUserId) ?? [];

  // Query members for all teams in one batch so we can look up Admin names
  // without calling hooks conditionally (single useQuery call).
  const allTeamIds = teamsQuery.data?.teams.map((t) => t.id) ?? [];
  const allMembersQuery = useQuery({
    queryKey: ['team-members-all', ...allTeamIds],
    queryFn: async () => {
      const results = await Promise.all(
        allTeamIds.map((id) => teamsApi.listMembers(id))
      );
      return Object.fromEntries(
        allTeamIds.map((id, i) => [id, results[i]])
      );
    },
    enabled: allTeamIds.length > 0,
  });
  const membersByTeamId = allMembersQuery.data ?? {};

  useEffect(() => {
    if (accountQuery.data) {
      setAccount(accountQuery.data.account);
      setEntitlements(accountQuery.data.entitlements);
    }
  }, [accountQuery.data, setAccount, setEntitlements]);

  useEffect(() => {
    void headingRef.current?.focus?.();
  }, []);

  if (accountQuery.isLoading) {
    return (
      <TeamScreenLayout testID="billing-screen">
        <Skeleton variant="block" style={[styles.skeleton, { height: 600 }]} />
      </TeamScreenLayout>
    );
  }

  if (view === 'quote') {
    return (
      <QuoteScreen
        onBack={() => setView('account')}
        onSuccess={() => {
          useTeamsView.setState({ message: 'billing.account.subscribed' });
          setView('account');
        }}
      />
    );
  }

  const acct = account;
  const ent = entitlements;

  const handleSubscribe = () => {
    setQuoteParams({ action: 'subscribe', interval: 'monthly', teamId: undefined, people: undefined });
    setView('quote');
  };
  const handleSwitchInterval = () => {
    const next = acct?.plan === 'monthly' ? 'yearly' : 'monthly';
    setQuoteParams({ action: 'switch_interval', interval: next, teamId: undefined, people: undefined });
    setView('quote');
  };
  const handleSelectInterval = (interval: 'monthly' | 'yearly') => {
    setQuoteParams({ action: 'subscribe', interval, teamId: undefined, people: undefined });
    setView('quote');
  };
  const handleCancel = () => setCancelConfirm(true);
  const handleCancelConfirm = async () => {
    setCancelConfirm(false);
    setBusy(true);
    try {
      const key = ensureKey('cancel');
      await billingApi.cancel(key);
      clearKey('cancel');
      if (acct) {
        setAccount({ ...acct, cancelAtPeriodEnd: true });
      }
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

  const handleResumeConfirm = async () => {
    setResumeConfirm(false);
    setBusy(true);
    try {
      const key = ensureKey('resume');
      const result = await billingApi.resume(key);
      clearKey('resume');
      if (result.resumed && acct) {
        setAccount({ ...acct, cancelAtPeriodEnd: false });
      }
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

  if (acct === null) {
    return (
      <TeamScreenLayout testID="billing-screen">
        <View style={styles.emptyState}>
          <EmptyState kind="empty" titleKey="billing.account.noAccount" bodyKey="billing.account.startTrial" />
          <Button
            label="billing.account.subscribe"
            variant="primary"
            onPress={handleSubscribe}
            testID="billing-subscribe"
          />
        </View>
      </TeamScreenLayout>
    );
  }

  const statusKey: Record<string, MessageKey> = {
    active: 'billing.account.status.active',
    trialing: 'billing.account.status.trialing',
    past_due: 'billing.account.status.past_due',
    read_only: 'billing.account.status.read_only',
    cancelled: 'billing.account.status.cancelled',
  };
  const statusTextKey = statusKey[acct.status] ?? 'billing.account.status.active';
  const isTrialing = acct.status === 'trialing';
  const trialEnds = acct.trialEndsAt ? formatDisplayDate(acct.trialEndsAt) : '-';
  const periodEnd = acct.periodEnd ? formatDisplayDate(acct.periodEnd) : '-';

  const intervalKey: Record<'monthly' | 'yearly', MessageKey> = {
    monthly: 'billing.interval.month',
    yearly: 'billing.interval.year',
  };
  const planLabel = t(intervalKey[acct.plan as 'monthly' | 'yearly']);

  // During a trial the allowance is the trial allowance (1 team, 10 people); paid plans use plan entitlements.
  const freeTeams = isTrialing ? (ent?.trialTeams ?? 0) : (ent?.freeTeams ?? 0);
  const peoplePerTeam = isTrialing ? (ent?.trialPeople ?? 0) : (ent?.peoplePerTeam ?? 0);

  return (
    <TeamScreenLayout testID="billing-screen">
      <View style={styles.headerRow}>
        <BText ref={headingRef} variant="headline-small" style={styles.heading} accessibilityRole="header">
          {t('billing.account.title')}
        </BText>
        <BillingBackButton onPress={teamsViewBack} testID="billing-back" accessibilityRole="button" />
      </View>

      {teamsViewMessage !== undefined ? (
        <Card variant="flat" style={styles.messageCard}>
          <BText variant="body-medium">{t(teamsViewMessage)}</BText>
        </Card>
      ) : null}

      {payerTeams.length > 0 ? (
        <>
          {payerTeams.map((payerTeam) => {
            const members = membersByTeamId[payerTeam.id]?.members ?? [];
            const admin = members.find((m) => m.role === 'owner');
            const adminName = admin?.displayName;

            // (b) Pay now: show payToUnlock for any payer whose team is pending_payment,
            // even if they are the Admin.
            if (payerTeam.coverageStatus === 'pending_payment') {
              return (
                <Card key={payerTeam.id} variant="flat" style={styles.messageCard}>
                  <BText variant="body-medium">
                    {t('billing.restricted.payToUnlock')}
                  </BText>
                  <Button
                    label="billing.restricted.payNow"
                    variant="secondary"
                    onPress={() => {
                      selectTeamId(payerTeam.id);
                      setQuoteParams({ action: 'add_team', interval: undefined, teamId: payerTeam.id, people: undefined });
                      teamsViewGo('quote');
                    }}
                    testID={`billing-pay-to-unlock-${payerTeam.id}`}
                  />
                </Card>
              );
            }

            // (a) Reminder: payer who is NOT the Admin shows "You still pay for {team}, run by {name}."
            // Show whether or not the team is restricted.
            if (payerTeam.role !== 'owner') {
              return (
                <Card key={payerTeam.id} variant="flat" style={styles.messageCard}>
                  <BText variant="body-medium">
                    {t('billing.account.payerBanner', {
                      team: payerTeam.name,
                      name: adminName ?? '',
                    })}
                  </BText>
                  <Button
                    label="billing.account.moveBilling"
                    variant="secondary"
                    onPress={() => {
                      selectTeamId(payerTeam.id);
                      teamsViewGo('move-billing');
                    }}
                    testID={`billing-payer-banner-${payerTeam.id}`}
                  />
                </Card>
              );
            }

            // Payer who IS the Admin and team is not pending_payment: show nothing.
            return null;
          })}
        </>
      ) : null}

      <View style={styles.infoCard}>
        <BText variant="title-medium">{t('billing.account.status')}</BText>
        <BText variant="body-large">{t(statusTextKey)}</BText>
        {isTrialing && acct.trialEndsAt ? (
          <BText variant="body-small" tone="secondary">
            {t('billing.account.trialEnds', { date: trialEnds })}
          </BText>
        ) : null}
      </View>

      {isTrialing ? (
        <View style={styles.infoCard}>
          <BText variant="title-medium">{t('billing.account.plan')}</BText>
          <BText variant="body-medium">
            {t(
              acct.plan === 'yearly' ? 'billing.account.nothingDueYear' : 'billing.account.nothingDueMonth',
              { amount: formatMinorToNaira(ent?.basePriceMinor ?? 0, acct.currency) },
            )}
          </BText>
        </View>
      ) : (
        <>
          <View style={styles.infoCard}>
            <BText variant="title-medium">{t('billing.account.plan')}</BText>
            <BText variant="body-large">{planLabel}</BText>
          </View>
          <View style={styles.infoCard}>
            <BText variant="title-medium">{t('billing.account.nextRenewal')}</BText>
            <BText variant="body-large">{periodEnd}</BText>
          </View>
        </>
      )}

      <View style={styles.infoCard}>
        <BText variant="title-medium">{t('billing.account.teams')}</BText>
        <BText variant="body-large">{String(freeTeams)}</BText>
        <BText variant="body-small" tone="secondary">
          {t('billing.account.peoplePerTeam', { count: peoplePerTeam })}
        </BText>
      </View>

      {acct.cancelAtPeriodEnd ? (
        <View style={styles.infoCard}>
          <BText variant="body-medium">{t('billing.account.cancelsOn', { date: periodEnd })}</BText>
        </View>
      ) : null}

      <View style={styles.actions}>
        {isTrialing ? (
          <>
            <Button
              label="billing.quote.subscribeMonthly"
              variant="secondary"
              onPress={() => handleSelectInterval('monthly')}
              testID="billing-subscribe-monthly"
            />
            <Button
              label="billing.quote.subscribeYearly"
              variant="primary"
              onPress={() => handleSelectInterval('yearly')}
              testID="billing-subscribe-yearly"
            />
          </>
        ) : (
          <>
            <Button
              label="billing.account.changeBillingPeriod"
              variant="secondary"
              onPress={handleSwitchInterval}
              testID="billing-switch-interval"
            />
            {acct.cancelAtPeriodEnd && acct.periodEnd && new Date(acct.periodEnd) > new Date() ? (
              <>
                <BText variant="body-small" tone="secondary">
                  {t('billing.account.planEndsOn', { date: periodEnd })}
                </BText>
                <Button
                  label="billing.account.keepMyPlan"
                  variant="secondary"
                  busy={busy}
                  onPress={() => setResumeConfirm(true)}
                  testID="billing-resume"
                />
              </>
            ) : acct.status === 'cancelled' ||
              acct.status === 'read_only' ||
              (acct.cancelAtPeriodEnd && (acct.periodEnd === null || new Date(acct.periodEnd) <= new Date())) ? (
              <Button
                label="billing.account.subscribeAgain"
                variant="primary"
                onPress={handleSubscribe}
                testID="billing-subscribe"
              />
            ) : (
              <Button
                label="billing.account.cancel"
                variant="danger"
                busy={busy}
                onPress={handleCancel}
                testID="billing-cancel"
              />
            )}
          </>
        )}
      </View>

      {teamsQuery.data?.teams.some((team) => team.coverageStatus === 'pending_payment') ? (
        <View style={styles.pendingSection}>
          <BText variant="title-medium">{t('billing.account.title')}</BText>
          {teamsQuery.data.teams
            .filter((team) => team.coverageStatus === 'pending_payment')
            .map((team) => (
              <Card key={team.id} variant="flat" style={styles.pendingCard}>
                <BText variant="body-medium">{team.name}</BText>
                <Button
                  label="billing.payToActivate"
                  variant="primary"
                  onPress={() => {
                    selectTeamId(team.id);
                    setQuoteParams({ action: 'add_team', interval: undefined, teamId: team.id, people: undefined });
                    teamsViewGo('quote');
                  }}
                  testID={`billing-pay-activate-${team.id}`}
                />
              </Card>
            ))}
        </View>
      ) : null}

      {error ? (
        <Card variant="flat" style={styles.errorCard}>
          <BText variant="body-medium" tone="error">{error}</BText>
        </Card>
      ) : null}

      <ConfirmDialog
        visible={cancelConfirm}
        titleKey="billing.account.cancelConfirm"
        messageKey="billing.account.cancelConfirmBody"
        messageParams={{ date: periodEnd }}
        confirmLabel="billing.account.cancelConfirmButton"
        cancelLabel="billing.account.cancelDismiss"
        busy={busy}
        onConfirm={() => {
          void handleCancelConfirm();
        }}
        onCancel={() => setCancelConfirm(false)}
        testID="billing-cancel-confirm"
      />
      <ConfirmDialog
        visible={resumeConfirm}
        titleKey="billing.account.resumeConfirm"
        messageKey="billing.account.resumeConfirmBody"
        confirmLabel="billing.account.resumeConfirmButton"
        cancelLabel="billing.account.resumeDismiss"
        busy={busy}
        onConfirm={() => {
          void handleResumeConfirm();
        }}
        onCancel={() => setResumeConfirm(false)}
        testID="billing-resume-confirm"
      />
    </TeamScreenLayout>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: typeStyle('headline-small').fontSize, marginBottom: spacing.small },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.base },
  infoCard: { flex: 1, minWidth: 140, marginBottom: spacing.base },
  priceCard: { flex: 1, minWidth: 140, marginBottom: spacing.base },
  emptyState: { alignItems: 'center', paddingVertical: spacing.extraLarge },
  actions: { gap: spacing.small, marginTop: spacing.base },
  pendingSection: { marginBottom: spacing.base },
  pendingCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Number(spacing.base),
    padding: Number(spacing.base),
  },
  errorCard: { marginBottom: spacing.base },
  messageCard: { marginBottom: spacing.base },
  skeleton: { width: '100%', alignSelf: 'center' },
});
