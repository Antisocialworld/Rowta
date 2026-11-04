// SwapsListScreen — team swap requests, cursor-paginated with four list states (Phase 5; PRD 8.5).
// Owner/Manager can approve or reject pending swaps; staff can view and cancel their own.
// Fast scrolling protected by createPagingGate and canRequestNextPage.
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View, type TextInputInstance, type TextInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SwapRequestView } from '@rowta/shared';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  LiveRegion,
  SheetModal,
  Skeleton,
  SwapTargetModal,
  Text,
} from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { authApi, errorMessageKey, swapsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { canRequestNextPage, createPagingGate } from '../../lib/shift-feed';
import {
  buildDecideSwapPayload,
  canCancelSwap,
  canDecideSwapWithShift,
  filterSwapsByTab,
  formatDeclineReasonCounter,
  getEligibleSwapTargets,
  isDeclineReady,
  mergeSwapPages,
  needsTargetPicker,
  SWAP_DECLINE_REASON_MAX_LENGTH,
  type SwapFilterTab,
} from '../../lib/swap-logic';
import { formatShiftDay, formatShiftTimeRange } from '../../lib/shift-time';
import { useShiftNav } from '../../state/shift-nav';
import { useTeam, useTeamMembers, useTeams } from '../../state/teams';
import { colors, shape, spacing } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../../theme/layout';

const END_KEY: MessageKey = 'swap.end';

export function SwapsListScreen() {
  const headingRef = useRef<TextInstance>(null);
  const back = useShiftNav((state) => state.back);
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const teamQuery = useTeam(selectedTeamId);
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.me(),
    staleTime: 5 * 60 * 1000,
  });

  const [tab, setTab] = useState<SwapFilterTab>('pending');
  const [cancellingSwapId, setCancellingSwapId] = useState<string | null>(null);
  const [approvingSwap, setApprovingSwap] = useState<SwapRequestView | null>(null);
  const [decliningSwap, setDecliningSwap] = useState<SwapRequestView | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [declineFieldError, setDeclineFieldError] = useState<MessageKey | null>(null);
  const [declineModalError, setDeclineModalError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState<MessageKey | null>(null);

  const declineInputRef = useRef<TextInputInstance>(null);
  const declineButtonRefs = useRef<Map<string, unknown>>(new Map());
  const lastDecliningSwapIdRef = useRef<string | null>(null);

  if (decliningSwap) {
    lastDecliningSwapIdRef.current = decliningSwap.id;
  }

  const declineReturnFocusRef = useRef<{ current: unknown }>({ current: null });
  declineReturnFocusRef.current.current = lastDecliningSwapIdRef.current
    ? declineButtonRefs.current.get(lastDecliningSwapIdRef.current) ?? null
    : null;

  const membersQuery = useTeamMembers(selectedTeamId);
  const eligibleMembers = approvingSwap
    ? getEligibleSwapTargets(membersQuery.data?.members ?? [], approvingSwap.requestedBy)
    : [];

  const query = useInfiniteQuery({
    queryKey: ['swaps', selectedTeamId, tab],
    queryFn: ({ pageParam }) =>
      swapsApi.listSwaps(selectedTeamId as string, {
        cursor: pageParam,
        status: tab === 'pending' ? 'pending' : undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: selectedTeamId !== null,
  });

  const fetchRef = useRef(query.fetchNextPage);
  fetchRef.current = query.fetchNextPage;
  const [gate] = useState(() => createPagingGate(() => fetchRef.current()));

  const rawSwaps = mergeSwapPages(
    [],
    (query.data?.pages ?? []).flatMap((page) => page.swaps),
  );
  const currentUserId = meQuery.data?.userId ?? '';
  const swaps = filterSwapsByTab(rawSwaps, tab, currentUserId);

  useEffect(() => {
    focusOn(headingRef.current);
  }, []);

  useEffect(() => {
    if (decliningSwap) {
      const timer = setTimeout(() => {
        focusOn(declineInputRef.current);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [decliningSwap]);

  const requestMore = (): void => {
    if (
      !canRequestNextPage({
        hasNextPage: query.hasNextPage,
        isFetchingNextPage: query.isFetchingNextPage,
        isBusy: gate.isBusy(),
      })
    ) {
      return;
    }
    void gate.request();
  };

  const handleApprove = async (swapId: string, targetUserId?: string) => {
    if (!selectedTeamId) return;
    setBusy(true);
    setAnnouncement(null);
    try {
      const payload = buildDecideSwapPayload('approved', { targetUserId: targetUserId ?? null });
      await swapsApi.decideSwap(selectedTeamId, swapId, payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['swaps', selectedTeamId] }),
        queryClient.invalidateQueries({ queryKey: ['shifts', selectedTeamId] }),
        queryClient.invalidateQueries({ queryKey: ['swaps'] }),
        queryClient.invalidateQueries({ queryKey: ['shifts'] }),
      ]);
      setAnnouncement('swap.toast.approved');
      setApprovingSwap(null);
    } catch (err: unknown) {
      const code = err instanceof Error && 'code' in err ? String((err as { code: string }).code) : 'generic.error';
      setAnnouncement(errorMessageKey(code));
    } finally {
      setBusy(false);
    }
  };

  const handleOpenDeclineModal = (swap: SwapRequestView) => {
    setDecliningSwap(swap);
    setDeclineReason('');
    setDeclineFieldError(null);
    setDeclineModalError(null);
  };

  const handleCloseDeclineModal = () => {
    setDecliningSwap(null);
    setDeclineReason('');
    setDeclineFieldError(null);
    setDeclineModalError(null);
  };

  const handleConfirmDecline = async () => {
    if (!selectedTeamId || !decliningSwap) return;
    const trimmed = declineReason.trim();
    if (trimmed.length === 0) {
      setDeclineFieldError('swap.decline_reason_required');
      return;
    }
    if (trimmed.length > SWAP_DECLINE_REASON_MAX_LENGTH) {
      setDeclineFieldError('swap.decline_reason_invalid');
      return;
    }
    setBusy(true);
    setDeclineFieldError(null);
    setDeclineModalError(null);
    try {
      const payload = buildDecideSwapPayload('rejected', { declineReason: trimmed });
      await swapsApi.decideSwap(selectedTeamId, decliningSwap.id, payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['swaps', selectedTeamId] }),
        queryClient.invalidateQueries({ queryKey: ['shifts', selectedTeamId] }),
        queryClient.invalidateQueries({ queryKey: ['swaps'] }),
        queryClient.invalidateQueries({ queryKey: ['shifts'] }),
      ]);
      setAnnouncement('swap.toast.rejected');
      handleCloseDeclineModal();
    } catch (err: unknown) {
      const code = err instanceof Error && 'code' in err ? String((err as { code: string }).code) : 'generic.error';
      setDeclineModalError(errorMessageKey(code));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedTeamId || !cancellingSwapId) return;
    setBusy(true);
    setAnnouncement(null);
    try {
      await swapsApi.cancelSwap(selectedTeamId, cancellingSwapId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['swaps', selectedTeamId] }),
        queryClient.invalidateQueries({ queryKey: ['shifts', selectedTeamId] }),
        queryClient.invalidateQueries({ queryKey: ['swaps'] }),
        queryClient.invalidateQueries({ queryKey: ['shifts'] }),
      ]);
      setAnnouncement('swap.toast.cancelled');
      setCancellingSwapId(null);
    } catch (err: unknown) {
      const code = err instanceof Error && 'code' in err ? String((err as { code: string }).code) : 'generic.error';
      setAnnouncement(errorMessageKey(code));
      setCancellingSwapId(null);
    } finally {
      setBusy(false);
    }
  };

  const role = teamQuery.data?.role ?? 'staff';

  const renderFooter = () => {
    return (
      <View style={styles.footerContainer}>
        {query.isFetchingNextPage ? (
          <Skeleton variant="text" />
        ) : query.hasNextPage ? (
          <Button label="action.loadMore" variant="secondary" onPress={requestMore} testID="swaps-load-more" />
        ) : (
          <LiveRegion style={styles.visuallyHidden}>{END_KEY}</LiveRegion>
        )}
        <Button label="action.back" variant="ghost" onPress={back} />
      </View>
    );
  };

  const renderSwapItem = ({ item }: { item: SwapRequestView }) => {
    const isPending = item.status === 'pending';
    const canCancel = canCancelSwap(item, currentUserId, role);
    const canDecide = canDecideSwapWithShift(role, item.shiftDeleted);

    const shiftTimeText = (item.shiftStartsAt && item.shiftEndsAt)
      ? `${formatShiftDay(item.shiftStartsAt)} ${formatShiftTimeRange(item.shiftStartsAt, item.shiftEndsAt)}`
      : '';

    const statusKey: MessageKey = `swap.status.${item.status}` as MessageKey;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text variant="title-medium">{item.shiftLabel ?? t('teams.view.shift.heading')}</Text>
          <Text variant="label-medium" tone={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'error' : 'secondary'}>
            {t(statusKey)}
          </Text>
        </View>

        {item.shiftDeleted ? (
          <View style={styles.deletedNotice} testID={`swap-shift-deleted-${item.id}`}>
            <Text variant="label-medium" tone="error">
              {t('swap.notice.shiftDeleted')}
            </Text>
          </View>
        ) : null}

        {shiftTimeText ? (
          <Text variant="body-medium" tone="secondary">
            {shiftTimeText}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          <Text variant="body-small">
            {item.requesterName ?? t('activity.system')} → {item.targetName ?? t('swap.colleague.open')}
          </Text>
        </View>

        {isPending ? (
          <View style={styles.cardActions}>
            {canDecide ? (
              <>
                <Button
                  label="swap.action.approve"
                  variant="primary"
                  busy={busy}
                  ready={!busy}
                  onPress={() => {
                    if (needsTargetPicker(item)) {
                      setApprovingSwap(item);
                    } else {
                      void handleApprove(item.id);
                    }
                  }}
                  testID={`swap-approve-${item.id}`}
                />
                <Button
                  ref={(node) => {
                    if (node) {
                      declineButtonRefs.current.set(item.id, node);
                    } else {
                      declineButtonRefs.current.delete(item.id);
                    }
                  }}
                  label="swap.action.reject"
                  variant="secondary"
                  busy={busy}
                  ready={!busy}
                  onPress={() => handleOpenDeclineModal(item)}
                  testID={`swap-reject-${item.id}`}
                />
              </>
            ) : null}
            {canCancel ? (
              <Button
                label="swap.action.cancel"
                variant="ghost"
                busy={busy}
                ready={!busy}
                onPress={() => setCancellingSwapId(item.id)}
                testID={`swap-cancel-${item.id}`}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  const trimmedDeclineReason = declineReason.trim();
  const declineNotReadyReason: MessageKey | undefined =
    trimmedDeclineReason.length === 0
      ? 'swap.decline_reason_required'
      : trimmedDeclineReason.length > SWAP_DECLINE_REASON_MAX_LENGTH
        ? 'swap.decline_reason_invalid'
        : undefined;

  const declineFooter = (
    <View style={styles.modalFooterRow}>
      <Button
        label="swap.declineModal.cancel"
        variant="ghost"
        fullWidth={false}
        onPress={handleCloseDeclineModal}
        testID="swap-decline-cancel"
      />
      <Button
        label="swap.declineModal.confirm"
        variant="danger"
        fullWidth={false}
        busy={busy}
        ready={isDeclineReady(declineReason, busy)}
        reason={declineNotReadyReason}
        onNotReady={() => {
          if (declineNotReadyReason) {
            setDeclineFieldError(declineNotReadyReason);
            focusOn(declineInputRef.current);
          }
        }}
        onPress={() => void handleConfirmDecline()}
        testID="swap-decline-confirm"
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <Text ref={headingRef} variant="headline-small" accessibilityRole="header">
          {t('swap.list.title')}
        </Text>

        {/* Filter Tabs */}
        <View style={styles.tabs} accessibilityRole="tablist">
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'pending' }}
            style={[styles.tab, tab === 'pending' && styles.activeTab]}
            onPress={() => setTab('pending')}
          >
            <Text variant="label-large" tone={tab === 'pending' ? 'primary' : 'secondary'}>
              {t('swap.list.tab.pending')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'my' }}
            style={[styles.tab, tab === 'my' && styles.activeTab]}
            onPress={() => setTab('my')}
          >
            <Text variant="label-large" tone={tab === 'my' ? 'primary' : 'secondary'}>
              {t('swap.list.tab.my')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'all' }}
            style={[styles.tab, tab === 'all' && styles.activeTab]}
            onPress={() => setTab('all')}
          >
            <Text variant="label-large" tone={tab === 'all' ? 'primary' : 'secondary'}>
              {t('swap.list.tab.all')}
            </Text>
          </Pressable>
        </View>

        {query.isLoading ? (
          <View style={styles.list}>
            <Skeleton variant="block" />
            <Skeleton variant="block" />
          </View>
        ) : query.isError ? (
          <View style={styles.emptyContainer}>
            <EmptyState kind="error" action={{ label: 'action.retry', onPress: () => void query.refetch() }} />
            <Button label="action.back" variant="ghost" onPress={back} />
          </View>
        ) : swaps.length === 0 ? (
          <View style={styles.emptyContainer}>
            <EmptyState kind="empty" titleKey="swap.empty.title" bodyKey="swap.empty.body" />
            <Button label="action.back" variant="ghost" onPress={back} />
          </View>
        ) : (
          <FlatList
            style={styles.list}
            contentContainerStyle={styles.listContent}
            data={swaps}
            keyExtractor={(item) => item.id}
            renderItem={renderSwapItem}
            onEndReached={requestMore}
            onEndReachedThreshold={0.4}
            ListFooterComponent={renderFooter}
          />
        )}

        {announcement !== null ? <LiveRegion>{announcement}</LiveRegion> : null}
      </View>

      <SwapTargetModal
        visible={approvingSwap !== null}
        members={eligibleMembers}
        isLoading={membersQuery.isLoading}
        isError={membersQuery.isError}
        submitting={busy}
        onRetry={() => void membersQuery.refetch()}
        onConfirm={(targetUserId) => {
          if (approvingSwap) {
            void handleApprove(approvingSwap.id, targetUserId);
          }
        }}
        onCancel={() => setApprovingSwap(null)}
        testID="swap-target-picker-modal"
      />

      <SheetModal
        visible={decliningSwap !== null}
        onClose={handleCloseDeclineModal}
        headingKey="swap.declineModal.title"
        returnFocusRef={declineReturnFocusRef.current}
        footer={declineFooter}
        testID="swap-decline-modal"
        cardTestID="swap-decline-modal-card"
        headingTestID="swap-decline-modal-heading"
      >
        <View style={styles.modalBody}>
          <Input
            ref={declineInputRef}
            label="swap.declineModal.reasonLabel"
            value={declineReason}
            onChangeText={(value) => {
              setDeclineReason(value);
              setDeclineFieldError(null);
              setDeclineModalError(null);
            }}
            variant="text"
            errorKey={declineFieldError ?? undefined}
            editable={!busy}
            testID="swap-decline-reason-input"
          />
          <Text
            variant="body-small"
            tone="secondary"
            style={styles.counterText}
            testID="swap-decline-counter"
          >
            {formatDeclineReasonCounter(declineReason)}
          </Text>
          {declineModalError !== null ? (
            <LiveRegion tone="error">{declineModalError}</LiveRegion>
          ) : null}
        </View>
      </SheetModal>

      <ConfirmDialog
        visible={cancellingSwapId !== null}
        titleKey="swap.confirm.cancelTitle"
        messageKey="swap.confirm.cancelBody"
        confirmLabel="swap.action.cancel"
        destructive
        busy={busy}
        onConfirm={() => void handleCancel()}
        onCancel={() => setCancellingSwapId(null)}
        testID="swap-cancel-dialog"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors['color-surface'] },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    padding: Number(spacing.base),
    gap: Number(spacing.base),
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors['color-outline-variant'],
    gap: Number(spacing.small),
  },
  tab: {
    paddingVertical: Number(spacing.small),
    paddingHorizontal: Number(spacing.base),
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: colors['color-primary'],
  },
  list: { flex: 1 },
  listContent: { gap: Number(spacing.base), paddingBottom: Number(spacing.base) },
  card: {
    backgroundColor: colors['color-surface-container-low'],
    borderRadius: Number(shape.medium),
    padding: Number(spacing.base),
    gap: Number(spacing.small),
    borderWidth: 1,
    borderColor: colors['color-outline-variant'],
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  deletedNotice: {
    paddingVertical: Number(spacing.extraSmall),
    paddingHorizontal: Number(spacing.small),
    backgroundColor: colors['color-error-container'],
    borderRadius: Number(shape.small),
    alignSelf: 'flex-start',
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Number(spacing.small),
    marginTop: Number(spacing.small),
  },
  visuallyHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
  footerContainer: {
    gap: Number(spacing.base),
    marginTop: Number(spacing.base),
  },
  emptyContainer: {
    gap: Number(spacing.base),
  },
  modalFooterRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Number(spacing.small),
  },
  modalBody: {
    gap: Number(spacing.base),
  },
  counterText: {
    alignSelf: 'flex-end',
  },
});
