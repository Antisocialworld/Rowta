// ShiftDetailScreen — one shift's details and the Owner/Manager actions (Phase 4; PRD 6.1, 8.3).
// Phase 5: "Request swap" for shift's assignee with optimistic update, busy/disabled accessibility,
// and rollback on failure with announced error message (PRD 8.5, rule C7).
import { useEffect, useReducer, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type TextInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ConfirmDialog, EmptyState, LiveRegion, Skeleton, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { ApiError, authApi, errorMessageKey, shiftsApi, swapsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { canManageShifts } from '../../lib/shift-access';
import {
  canRequestSwap,
  INITIAL_SHIFT_SWAP_STATE,
  shiftSwapReducer,
} from '../../lib/swap-logic';
import { formatShiftDay, formatShiftTimeRange } from '../../lib/shift-time';
import { useShiftNav } from '../../state/shift-nav';
import { useTeam, useTeamMembers, useTeams } from '../../state/teams';
import { colors, shape, spacing } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../../theme/layout';

function createIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function ShiftDetailScreen() {
  const headingRef = useRef<TextInstance>(null);
  const queryClient = useQueryClient();
  const open = useShiftNav((state) => state.open);
  const back = useShiftNav((state) => state.back);
  const route = useShiftNav((state) => state.route);
  const shiftId = route?.name === 'detail' ? route.shiftId : null;
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const teamQuery = useTeam(selectedTeamId);
  const membersQuery = useTeamMembers(selectedTeamId);

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.me(),
    staleTime: 5 * 60 * 1000,
  });

  const shiftQuery = useQuery({
    queryKey: ['shifts', selectedTeamId, 'detail', shiftId],
    queryFn: () => shiftsApi.getShift(selectedTeamId as string, shiftId as string),
    enabled: selectedTeamId !== null && shiftId !== null,
  });

  const pendingSwapQuery = useQuery({
    queryKey: ['swaps', selectedTeamId, 'shift', shiftId],
    queryFn: () =>
      swapsApi.listSwaps(selectedTeamId as string, {
        shiftId: shiftId as string,
        status: 'pending',
      }),
    enabled: selectedTeamId !== null && shiftId !== null,
  });

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState<MessageKey | null>(null);
  const [showColleaguePicker, setShowColleaguePicker] = useState(false);
  const [selectedColleagueId, setSelectedColleagueId] = useState<string | null>(null);

  const [swapState, dispatchSwap] = useReducer(shiftSwapReducer, INITIAL_SHIFT_SWAP_STATE);

  useEffect(() => {
    focusOn(headingRef.current);
  }, []);

  useEffect(() => {
    if (pendingSwapQuery.data && pendingSwapQuery.data.swaps.length > 0) {
      const pending = pendingSwapQuery.data.swaps[0];
      if (pending) {
        dispatchSwap({ type: 'request_success', swapId: pending.id });
      }
    }
  }, [pendingSwapQuery.data]);

  const manager = canManageShifts(teamQuery.data?.role);
  const shift = shiftQuery.data;
  const currentUserId = meQuery.data?.userId ?? '';

  const isAssignee = shift ? shift.assignee.userId === currentUserId : false;
  const eligibleForSwap =
    shift &&
    isAssignee &&
    canRequestSwap(
      { assignedUserId: shift.assignee.userId, endsAt: shift.endsAt },
      currentUserId,
      swapState.hasPendingSwap,
    );

  const remove = async (): Promise<void> => {
    if (selectedTeamId === null || shiftId === null) return;
    setBusy(true);
    setAnnouncement(null);
    try {
      await shiftsApi.deleteShift(selectedTeamId, shiftId);
      await queryClient.invalidateQueries({ queryKey: ['shifts'] });
      await queryClient.invalidateQueries({ queryKey: ['teams'] });
      setAnnouncement('shift.toast.deleted');
      setConfirming(false);
      back();
    } catch (error) {
      setAnnouncement(error instanceof ApiError ? errorMessageKey(error.code) : 'generic.error');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const requestSwapAction = async (): Promise<void> => {
    if (!selectedTeamId || !shiftId) return;

    // 1. OPTIMISTIC UPDATE: flip state immediately
    dispatchSwap({ type: 'request_start' });
    setAnnouncement(null);
    setShowColleaguePicker(false);

    const idempotencyKey = createIdempotencyKey();

    try {
      const res = await swapsApi.requestSwap(
        selectedTeamId,
        { shiftId, targetUserId: selectedColleagueId },
        idempotencyKey,
      );
      dispatchSwap({ type: 'request_success', swapId: res.id });
      setAnnouncement('swap.toast.requested');
      await queryClient.invalidateQueries({ queryKey: ['swaps'] });
    } catch (err: unknown) {
      // 2. ROLLBACK: restore previous state and announce error
      const code = err instanceof ApiError ? err.code : 'generic.error';
      const msgKey = errorMessageKey(code);
      dispatchSwap({ type: 'request_failure', error: t(msgKey) });
      setAnnouncement(msgKey);
    }
  };

  const colleagues = (membersQuery.data?.members ?? []).filter((m) => m.userId !== currentUserId);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text ref={headingRef} variant="headline-small" accessibilityRole="header">
            {t('teams.view.shift.heading')}
          </Text>

          {shiftQuery.isLoading ? (
            <View style={styles.stack}>
              <Skeleton variant="text" />
              <Skeleton variant="text" />
              <Skeleton variant="block" />
            </View>
          ) : shiftQuery.isError ? (
            <EmptyState kind="error" action={{ label: 'action.retry', onPress: () => void shiftQuery.refetch() }} />
          ) : shift === undefined ? (
            <EmptyState kind="empty" titleKey="shift.empty.title" bodyKey="shift.empty.body" />
          ) : (
            <View style={styles.stack}>
              <Text variant="title-large">{shift.label}</Text>

              <View style={styles.field}>
                <Text variant="label-medium" tone="secondary">
                  {t('shift.detail.startsAt')}
                </Text>
                <Text variant="body-medium">
                  {formatShiftDay(shift.startsAt)} {formatShiftTimeRange(shift.startsAt, shift.endsAt)}
                </Text>
              </View>

              <View style={styles.field}>
                <Text variant="label-medium" tone="secondary">
                  {t('shift.detail.assignee')}
                </Text>
                <Text variant="body-medium">{shift.assignee.displayName}</Text>
              </View>

              {shift.notes !== null && shift.notes.length > 0 ? (
                <View style={styles.field}>
                  <Text variant="label-medium" tone="secondary">
                    {t('shift.detail.notes')}
                  </Text>
                  <Text variant="body-medium">{shift.notes}</Text>
                </View>
              ) : null}

              {/* Phase 5: Swap Actions for Assignee */}
              {isAssignee ? (
                <View style={styles.swapSection}>
                  {swapState.hasPendingSwap ? (
                    <Button
                      label="swap.requested"
                      variant="secondary"
                      ready={false}
                      busy={swapState.isRequesting}
                      onPress={() => undefined}
                      testID="shift-swap-requested-btn"
                    />
                  ) : eligibleForSwap ? (
                    <>
                      {showColleaguePicker ? (
                        <View style={styles.pickerBox}>
                          <Text variant="label-medium">{t('swap.colleague.label')}</Text>
                          <Button
                            label={selectedColleagueId ? 'swap.colleague.open' : 'action.select'}
                            variant="ghost"
                            onPress={() => setSelectedColleagueId(null)}
                          />
                          {colleagues.map((c) => (
                            <Button
                              key={c.userId}
                              label={selectedColleagueId === c.userId ? 'action.done' : 'action.select'}
                              variant={selectedColleagueId === c.userId ? 'primary' : 'ghost'}
                              onPress={() => setSelectedColleagueId(c.userId)}
                            />
                          ))}
                          <Button
                            label="swap.request"
                            variant="primary"
                            busy={swapState.isRequesting}
                            ready={!swapState.isRequesting}
                            onPress={() => void requestSwapAction()}
                            testID="shift-request-swap-submit-btn"
                          />
                        </View>
                      ) : (
                        <Button
                          label={swapState.isRequesting ? 'swap.requesting' : 'swap.request'}
                          icon="sync"
                          variant="primary"
                          busy={swapState.isRequesting}
                          ready={!swapState.isRequesting}
                          onPress={() => void requestSwapAction()}
                          testID="shift-request-swap-btn"
                        />
                      )}
                    </>
                  ) : null}
                </View>
              ) : null}

              {/* View team swaps button */}
              <Button
                label="swap.list.title"
                variant="ghost"
                icon="sync"
                onPress={() => open({ name: 'swaps' })}
                testID="shift-view-all-swaps-btn"
              />

              {manager ? (
                <View style={styles.actions}>
                  <Button
                    label="action.edit"
                    icon="edit"
                    onPress={() => open({ name: 'edit', shiftId: shift.id })}
                    testID="shift-edit-entry"
                  />
                  <Button
                    label="action.delete"
                    icon="delete-outline"
                    variant="danger"
                    onPress={() => setConfirming(true)}
                    testID="shift-delete-entry"
                  />
                </View>
              ) : null}
            </View>
          )}

          {announcement !== null ? <LiveRegion>{announcement}</LiveRegion> : null}
          <Button label="action.back" variant="ghost" onPress={back} />
        </ScrollView>
      </View>

      <ConfirmDialog
        visible={confirming}
        titleKey="shift.delete.title"
        messageKey="shift.delete.message"
        confirmLabel="action.delete"
        destructive
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
        testID="shift-delete-dialog"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors['color-surface'] },
  container: { flex: 1, alignItems: 'center', padding: Number(spacing.base) },
  content: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, gap: Number(spacing.base), paddingBottom: Number(spacing.base) },
  stack: { gap: Number(spacing.base) },
  field: { gap: Number(spacing.extraSmall) },
  swapSection: { gap: Number(spacing.small), marginVertical: Number(spacing.small) },
  pickerBox: {
    padding: Number(spacing.base),
    borderRadius: Number(shape.medium),
    borderWidth: 1,
    borderColor: colors['color-outline-variant'],
    gap: Number(spacing.small),
  },
  actions: { gap: Number(spacing.small) },
});
