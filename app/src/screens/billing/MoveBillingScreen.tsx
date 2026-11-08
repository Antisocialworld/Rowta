// MoveBillingScreen — move a team's billing to another account (D3, C6 routes).
// Only the paying owner can request; only the team's current Admin can accept/decline.
// Reuses the C6 /teams/:teamId/billing/move/* routes.
// Every message is shown only to the right person (payer or receiver). Names, never raw user IDs.
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInstance, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { BillingBackButton, Button, Card, ConfirmDialog, Skeleton, Text as BText } from '../../components';
import { type MemberItem } from '@rowta/shared';
import { t } from '../../i18n/en';
import { ApiError } from '../../lib/api';
import { billingApi } from '../../api/billing';
import { useBilling } from '../../state/billing';
import { useTeam, useTeamMembers, useTeams } from '../../state/teams';
import { useTeamsView } from '../../state/teams-view';
import { TeamScreenLayout } from '../teams/TeamScreenLayout';
import { typeStyle } from '../../theme/fonts';
import { colors, shape, spacing } from '../../theme/tokens';
import { RING } from '../../theme/layout';
import { formatDisplayDate } from '../../lib/shift-time';

export function MoveBillingScreen() {
  const headingRef = useRef<TextInstance>(null);
  const { error, setError, ensureKey } = useBilling();
  const { selectedTeamId } = useTeams((state) => state);
  const teamsViewBack = useTeamsView((state) => state.back);

  const moveQuery = useQuery({
    queryKey: ['billing', 'move', selectedTeamId],
    queryFn: async () => {
      if (!selectedTeamId) return null;
      return billingApi.getMove(selectedTeamId);
    },
    enabled: selectedTeamId !== null,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const accountQuery = useQuery({
    queryKey: ['billing', 'account-move'],
    queryFn: () => billingApi.accountStatus(),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const teamQuery = useTeam(selectedTeamId);
  const membersQuery = useTeamMembers(selectedTeamId);

  const currentUserId = accountQuery.data?.account?.userId ?? null;
  const team = teamQuery.data;
  const members: MemberItem[] = membersQuery.data?.members ?? [];
  const payerUserId = team?.payerUserId ?? null;
  const isPayer = currentUserId !== null && payerUserId !== null && currentUserId === payerUserId;
  const isAdmin = members.some((m) => m.role === 'owner' && m.userId === currentUserId);
  const memberById = new Map(members.map((m) => [m.userId, m.displayName]));
  // The server accepts only the team's current Admin (role 'owner', shown as 'Admin') as receiver.
  const eligibleReceivers = members.filter((m: MemberItem) => m.role === 'owner' && m.userId !== currentUserId);

  const [receiverUserId, setReceiverUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [acceptConfirm, setAcceptConfirm] = useState(false);

  const handleRequest = async () => {
    if (!selectedTeamId || !receiverUserId) return;
    setBusy(true);
    try {
      const key = ensureKey('moveRequest');
      await billingApi.requestMove(selectedTeamId, receiverUserId, key);
      void moveQuery.refetch();
      setReceiverUserId('');
    } catch (error) {
      if (error instanceof ApiError) {
        setError(error.code);
      } else {
        setError('billing.error.generic');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAccept = async (moveId: string) => {
    if (!selectedTeamId) return;
    setBusy(true);
    try {
      const key = ensureKey('moveAccept');
      await billingApi.acceptMove(selectedTeamId, moveId, key);
      void moveQuery.refetch();
      setAcceptConfirm(false);
    } catch (error) {
      if (error instanceof ApiError) {
        setError(error.code);
      } else {
        setError('billing.error.generic');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async (moveId: string) => {
    if (!selectedTeamId) return;
    setBusy(true);
    try {
      await billingApi.declineMove(selectedTeamId, moveId);
      void moveQuery.refetch();
    } catch (error) {
      if (error instanceof ApiError) {
        setError(error.code);
      } else {
        setError('billing.error.generic');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (moveId: string) => {
    if (!selectedTeamId) return;
    setBusy(true);
    try {
      const key = ensureKey('moveCancel');
      await billingApi.cancelMove(selectedTeamId, moveId, key);
      void moveQuery.refetch();
    } catch (error) {
      if (error instanceof ApiError) {
        setError(error.code);
      } else {
        setError('billing.error.generic');
      }
    } finally {
      setBusy(false);
    }
  };

  if (moveQuery.isLoading || accountQuery.isLoading || teamQuery.isLoading || membersQuery.isLoading) {
    return (
      <TeamScreenLayout testID="move-billing-screen">
        <Skeleton variant="block" style={[styles.skeleton, { height: 500 }]} />
      </TeamScreenLayout>
    );
  }

  const move = moveQuery.data?.move ?? null;

  // When a move exists, determine what the current user should see.
  if (move) {
    const isExpired = move.expiresAt ? new Date(move.expiresAt).getTime() <= Date.now() : false;
    const status = isExpired ? 'expired' : move.status;

    // Receiver has a pending request → show confirmation dialog before accepting.
    if (status === 'requested' && move.toUserId === currentUserId) {
      const receiverName = memberById.get(move.toUserId) ?? t('billing.move.unknownMember');
      return (
        <TeamScreenLayout testID="move-billing-screen">
          <View style={styles.headerRow}>
            <BText ref={headingRef} variant="headline-small" style={styles.heading} accessibilityRole="header">
              {t('billing.move.title')}
            </BText>
            <BillingBackButton onPress={teamsViewBack} testID="move-back" accessibilityRole="button" />
          </View>

          <View style={styles.moveCard}>
            <BText variant="title-medium">
              {t('billing.move.pending', { name: receiverName })}
            </BText>
            <BText variant="body-small" tone="secondary">
              {t('billing.move.from', { name: memberById.get(move.fromUserId) ?? t('billing.move.unknownMember') })}
            </BText>
            <BText variant="body-small" tone="secondary">
              Expires {formatDisplayDate(move.expiresAt)}
            </BText>
          </View>

          <ConfirmDialog
            visible={acceptConfirm}
            titleKey="billing.move.acceptConfirm.title"
            messageKey="billing.move.acceptConfirm.body"
            confirmLabel="billing.move.acceptConfirmButton"
            cancelLabel="billing.move.acceptConfirmCancel"
            busy={busy}
            onConfirm={() => void handleAccept(move.id)}
            onCancel={() => setAcceptConfirm(false)}
            testID="move-accept-confirm"
          />

          <View style={styles.actions}>
            <Button
              label="billing.move.accept"
              variant="primary"
              busy={busy}
              onPress={() => setAcceptConfirm(true)}
              testID="move-accept"
            />
            <Button
              label="billing.move.decline"
              variant="secondary"
              onPress={() => void handleDecline(move.id)}
              testID="move-decline"
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

    // Payer's own request, still pending.
    if (status === 'requested' && move.fromUserId === currentUserId) {
      const receiverName = memberById.get(move.toUserId) ?? t('billing.move.unknownMember');
      return (
        <TeamScreenLayout testID="move-billing-screen">
          <View style={styles.headerRow}>
            <BText ref={headingRef} variant="headline-small" style={styles.heading} accessibilityRole="header">
              {t('billing.move.title')}
            </BText>
            <BillingBackButton onPress={teamsViewBack} testID="move-back" accessibilityRole="button" />
          </View>

          <View style={styles.moveCard}>
            <BText variant="body-medium">
              {t('billing.move.pendingPayer', { name: receiverName, date: formatDisplayDate(move.expiresAt) })}
            </BText>
          </View>

          <View style={styles.actions}>
            <Button
              label="billing.move.cancel"
              variant="danger"
              busy={busy}
              onPress={() => void handleCancel(move.id)}
              testID="move-cancel-pending"
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

    // Payer's own request expired.
    if (status === 'expired' && move.fromUserId === currentUserId) {
      return (
        <TeamScreenLayout testID="move-billing-screen">
          <View style={styles.headerRow}>
            <BText ref={headingRef} variant="headline-small" style={styles.heading} accessibilityRole="header">
              {t('billing.move.title')}
            </BText>
            <BillingBackButton onPress={teamsViewBack} testID="move-back" accessibilityRole="button" />
          </View>

          <View style={styles.moveCard}>
            <BText variant="body-medium">{t('billing.move.expiredPayer')}</BText>
          </View>

          {error ? (
            <Card variant="flat" style={styles.errorCard}>
              <BText variant="body-medium" tone="error">{error}</BText>
            </Card>
          ) : null}
        </TeamScreenLayout>
      );
    }

    // Any other state (accepted, declined, cancelled, or not relevant to current user).
    return (
      <TeamScreenLayout testID="move-billing-screen">
        <View style={styles.headerRow}>
          <BText ref={headingRef} variant="headline-small" style={styles.heading} accessibilityRole="header">
            {t('billing.move.title')}
          </BText>
          <BillingBackButton onPress={teamsViewBack} testID="move-back" accessibilityRole="button" />
        </View>

        {error ? (
          <Card variant="flat" style={styles.errorCard}>
            <BText variant="body-medium" tone="error">{error}</BText>
          </Card>
        ) : null}
      </TeamScreenLayout>
    );
  }

  // No move exists.
  // Payer who is also the Admin, with no eligible receiver → cannot request.
  if (isPayer && isAdmin && eligibleReceivers.length === 0) {
    return (
      <TeamScreenLayout testID="move-billing-screen">
        <View style={styles.headerRow}>
          <BText ref={headingRef} variant="headline-small" style={styles.heading} accessibilityRole="header">
            {t('billing.move.title')}
          </BText>
          <BillingBackButton onPress={teamsViewBack} testID="move-back" accessibilityRole="button" />
        </View>

        <View style={styles.moveCard}>
          <BText variant="body-medium">{t('billing.move.isPayerAdmin')}</BText>
        </View>

        {error ? (
          <Card variant="flat" style={styles.errorCard}>
            <BText variant="body-medium" tone="error">{error}</BText>
          </Card>
        ) : null}
      </TeamScreenLayout>
    );
  }

  // Payer who is also the Admin, with eligible receivers → can request.
  if (isPayer && isAdmin) {
    const selectedReceiverName =
      receiverUserId && memberById.get(receiverUserId)
        ? memberById.get(receiverUserId)!
        : null;

    return (
      <TeamScreenLayout testID="move-billing-screen">
        <View style={styles.headerRow}>
          <BText ref={headingRef} variant="headline-small" style={styles.heading} accessibilityRole="header">
            {t('billing.move.title')}
          </BText>
          <BillingBackButton onPress={teamsViewBack} testID="move-back" accessibilityRole="button" />
        </View>

        {selectedReceiverName ? (
          <View style={styles.moveCard}>
            <BText variant="body-medium">
              {t('billing.move.beforeRequest', { name: selectedReceiverName })}
            </BText>
          </View>
        ) : null}

        <View style={styles.requestCard}>
          <BText variant="title-medium">{t('billing.move.request')}</BText>
          <BText variant="body-small" tone="secondary">{t('billing.move.receiver')}</BText>
        </View>

        {eligibleReceivers.length === 0 ? (
          <View style={styles.emptyCard}>
            <BText variant="body-medium" tone="secondary">{t('billing.move.noEligibleReceiver')}</BText>
          </View>
        ) : (
          <View style={styles.receiverList}>
            {eligibleReceivers.map((member) => {
              const isSelected = member.userId === receiverUserId;
              return (
                <Pressable
                  key={member.userId}
                  onPress={() => setReceiverUserId(member.userId)}
                  accessibilityRole="button"
                  accessibilityLabel={member.displayName}
                  accessibilityState={{ selected: isSelected }}
                  testID={`move-receiver-${member.userId}`}
                  style={[styles.receiverRow, isSelected && styles.receiverRowSelected]}
                >
                  <View style={styles.receiverRowContent}>
                    <BText variant="body-medium">{member.displayName}</BText>
                    {isSelected ? (
                      <MaterialIcons
                        name="check"
                        size={18}
                        color={colors['color-primary']}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.actions}>
          <Button
            label="billing.move.request"
            variant="primary"
            busy={busy}
            onPress={() => {
              void handleRequest();
            }}
            testID="move-request"
            ready={receiverUserId.length > 0}
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

  // Not the payer, not the Admin, or no billing move actions available.
  return (
    <TeamScreenLayout testID="move-billing-screen">
      <View style={styles.headerRow}>
        <BText ref={headingRef} variant="headline-small" style={styles.heading} accessibilityRole="header">
          {t('billing.move.title')}
        </BText>
        <BillingBackButton onPress={teamsViewBack} testID="move-back" accessibilityRole="button" />
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
  moveCard: { flex: 1, minWidth: 140, marginBottom: spacing.base },
  requestCard: { flex: 1, minWidth: 140, marginBottom: spacing.base },
  inputCard: { flex: 1, minWidth: 140, marginBottom: spacing.base },
  actions: { gap: spacing.small, marginTop: spacing.base },
  errorCard: { marginBottom: spacing.base },
  skeleton: { width: '100%', alignSelf: 'center' },
  emptyCard: { alignItems: 'center', paddingVertical: spacing.base },
  receiverList: { gap: spacing.small },
  receiverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.small,
    borderWidth: RING,
    borderRadius: shape.medium,
    borderColor: colors['color-surface-container'],
  },
  receiverRowSelected: {
    borderColor: colors['color-primary'],
    backgroundColor: colors['color-secondary-container'],
  },
  receiverRowContent: { flexDirection: 'row', alignItems: 'center', gap: spacing.small, flex: 1 },
});
