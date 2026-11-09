// DashboardScreen — Phase 8 Stages A & B (rules U1, U2, U5, U8, X1, X2, X6; PRD 6.1, 8.3, 8.5, 12).
// Signed-in home view for the active team:
// 1. Greeting, team identity, role line, Teams trigger and "Updated HH:MM" freshness.
// 2. Quick navigation shortcuts (Calendar, Swaps).
// 3. "Your next shift" card (first upcoming / in-progress shift, loading, empty, error states).
// 4. "Your week" card (shifts in current week + count, loading, empty, error states).
// 5. "Pending swaps" card (Owner/Manager only; shown when count is 1 or more).
// 6. "Recent activity" card (latest 3 events for everyone).
// 7. Pull-to-refresh (RefreshControl refetches calendar, swaps, activity; updates freshness).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type TextInstance,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import type { ShiftView } from '@rowta/shared';
import { Badge, Button, BillingBanner, Card, EmptyState, ShiftCard, Skeleton, Text } from '../components';
import { t, type MessageKey } from '../i18n/en';
import { authApi, shiftsApi, swapsApi } from '../lib/api';
import { billingApi } from '../api/billing';
import { focusOn } from '../lib/a11y';
import { greetingKeyForHour } from '../lib/dashboard-greeting';
import { formatShiftDay, formatShiftTimeRange } from '../lib/shift-time';
import { teamContextLabel } from '../lib/team-context';
import {
  canViewPendingSwaps,
  excludeShiftById,
  filterThisWeekShifts,
  formatLastUpdatedTime,
  getDashboardCalendarRange,
  getLatestUpdatedTimestamp,
  pickNextShift,
  pickPendingSwaps,
  pickRecentActivity,
} from '../lib/dashboard-shifts';
import { AccountMenu } from '../components/AccountMenu';
import { activityEventShiftId } from '../lib/shift-feed';
import { useActivityClearedUntil } from '../lib/useActivityClearedUntil';
import { useTeams, useTeamsList } from '../state/teams';
import { useTeamsView } from '../state/teams-view';
import { useShiftNav } from '../state/shift-nav';
import { ActivityRow } from './shifts/ActivityRow';
import { colors, shape, spacing, state } from '../theme/tokens';
import {
  CONTENT_MAX_WIDTH,
  HAIRLINE,
  MIN_TOUCH_TARGET,
  RING,
  desktopCenterStyle,
  iconSize,
  isCompactWidth,
} from '../theme/layout';

const ROLE_LABEL: Record<string, MessageKey> = {
  owner: 'role.owner',
  manager: 'role.manager',
  staff: 'role.staff',
};

export function DashboardScreen() {
  const headingRef = useRef<TextInstance>(null);
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const setPickingTeam = useTeams((state) => state.setPickingTeam);
  const teamsViewGo = useTeamsView((state) => state.go);
  const openShift = useShiftNav((state) => state.open);
  const { width } = useWindowDimensions();
  const compact = isCompactWidth(width);
  const [swapsFocused, setSwapsFocused] = useState(false);

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.me(),
    staleTime: 5 * 60 * 1000,
  });

  const currentUserId = meQuery.data?.userId ?? '';
  const currentUserName = meQuery.data?.displayName ?? '';

  // Billing banner: trial ending within 3 days, or payment late / read-only.
  const accountQuery = useQuery({
    queryKey: ['billing', 'account'],
    queryFn: () => billingApi.accountStatus(),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const acct = accountQuery.data?.account ?? null;
  const trialDaysLeft =
    acct?.status === 'trialing' && acct.trialEndsAt
      ? Math.max(0, Math.ceil((new Date(acct.trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
      : 0;
  const showTrialBanner = acct?.status === 'trialing' && trialDaysLeft <= 3 && trialDaysLeft > 0;
  const showPaymentBanner = acct?.status === 'past_due' || acct?.status === 'read_only';
  const { clearedUntil: dashClearedUntil, isLoaded: dashIsLoaded } = useActivityClearedUntil(
    currentUserId,
    selectedTeamId,
  );

  const teamsQuery = useTeamsList();
  const selectedTeam = teamsQuery.data?.teams.find((t) => t.id === selectedTeamId);
  const role = selectedTeam?.role ?? 'staff';
  const isManagerOrOwner = canViewPendingSwaps(role);

  // 1. Calendar query: current week through next 14 days (21 days total, <= 42 limit)
  const range = useMemo(() => getDashboardCalendarRange(), []);
  const calendarQuery = useQuery({
    queryKey: ['shifts', selectedTeamId, range.from, range.to],
    queryFn: () => shiftsApi.listCalendar(selectedTeamId as string, range.from, range.to),
    enabled: selectedTeamId !== null,
  });

  // 2. Pending swaps query (Owner and Manager only; strictly disabled for Staff)
  const swapsQuery = useQuery({
    queryKey: ['swaps', selectedTeamId, 'dashboard-pending'],
    queryFn: () => swapsApi.listSwaps(selectedTeamId as string, { status: 'pending', limit: 20 }),
    enabled: selectedTeamId !== null && isManagerOrOwner,
  });

  // 3. Recent activity query (latest 3 events for everyone)
  const activityQuery = useQuery({
    queryKey: ['shifts', selectedTeamId, 'activity', 'recent', dashClearedUntil ?? null],
    queryFn: () =>
      shiftsApi.listActivity(selectedTeamId as string, undefined, 3, dashClearedUntil ?? undefined),
    enabled: selectedTeamId !== null && dashIsLoaded,
  });

  useEffect(() => {
    focusOn(headingRef.current);
  }, []);

  const shifts = calendarQuery.data?.shifts ?? [];

  // Derive "Your next shift" and "Your week" using pure helpers
  const nextShift = useMemo(() => pickNextShift(shifts, currentUserId), [shifts, currentUserId]);
  const thisWeekData = useMemo(
    () => filterThisWeekShifts(shifts, currentUserId, range.weekStart, range.weekEnd),
    [shifts, currentUserId, range.weekStart, range.weekEnd],
  );
  const weekShifts = useMemo(
    () => excludeShiftById(thisWeekData.shifts, nextShift?.id),
    [thisWeekData.shifts, nextShift?.id],
  );
  const weekCount = weekShifts.length;

  // Derive pending swaps data
  const pendingSwapsData = useMemo(
    () => pickPendingSwaps(swapsQuery.data?.swaps ?? []),
    [swapsQuery.data?.swaps],
  );
  const pendingCountKnown = isManagerOrOwner && swapsQuery.isSuccess;
  const showPendingBadge = pendingCountKnown && pendingSwapsData.count > 0;
  const pendingBadgeText =
    pendingSwapsData.count > 9
      ? t('dashboard.pendingSwaps.badgeCap')
      : String(pendingSwapsData.count);

  // Derive recent activity events
  const recentActivity = useMemo(
    () => pickRecentActivity(activityQuery.data?.events ?? [], 3),
    [activityQuery.data?.events],
  );

  const teamName = selectedTeam?.name ?? t('dashboard.title');
  const teamLabel = teamContextLabel(teamName);

  // Pull-to-refresh
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const promises: Promise<unknown>[] = [
        calendarQuery.refetch(),
        activityQuery.refetch(),
      ];
      if (isManagerOrOwner) {
        promises.push(swapsQuery.refetch());
      }
      await Promise.all(promises);
    } finally {
      setRefreshing(false);
    }
  }, [calendarQuery, activityQuery, swapsQuery, isManagerOrOwner]);

  const latestUpdatedAt = getLatestUpdatedTimestamp(
    calendarQuery.dataUpdatedAt,
    activityQuery.dataUpdatedAt,
    isManagerOrOwner ? swapsQuery.dataUpdatedAt : 0,
  );
  const updatedTime = formatLastUpdatedTime(latestUpdatedAt);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="dashboard-screen">
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                void handleRefresh();
              }}
              tintColor={colors['color-primary']}
              colors={[colors['color-primary']]}
            />
          }
        >
          <View style={[styles.content, desktopCenterStyle(width)]}>
            {/* 1. Header: greeting, team identity, role, last updated, Teams trigger */}
            <View style={styles.header}>
              <View style={styles.greetingRow}>
                <Text
                  ref={headingRef}
                  variant="headline-small"
                  style={styles.greetingTitle}
                >
                  {t(greetingKeyForHour(new Date().getHours()))}
                </Text>
                <AccountMenu testID="dashboard-account-button" />
              </View>

              <Card variant="flat" style={styles.identityCard}>
                <View style={styles.identityRow}>
                  <View style={styles.identityText}>
                    <Text
                      variant="title-medium"
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      style={styles.teamLabel}
                    >
                      {teamLabel}
                    </Text>
                  </View>
                  <View style={styles.teamsButton}>
                    <Button
                      label="dashboard.switchTeam"
                      variant="ghost"
                      fullWidth={false}
                      onPress={() => setPickingTeam(true)}
                      testID="dashboard-switch-team"
                    />
                  </View>
                </View>
                <Text variant="body-medium" tone="secondary">
                  {t('dashboard.roleLine', { role: t(ROLE_LABEL[role] ?? 'role.staff') })}
                </Text>
              </Card>
              {updatedTime ? (
                <Text variant="body-small" tone="secondary">
                  {t('dashboard.lastUpdated', { time: updatedTime })}
                </Text>
              ) : null}
            </View>

            {(showTrialBanner || showPaymentBanner) && (
              <BillingBanner
                kind={showTrialBanner ? 'trial_ending' : 'payment_late'}
                days={trialDaysLeft}
                onGoToBilling={() => void teamsViewGo('billing')}
              />
            )}

            {/* 2. Quick Navigation Shortcuts */}
            <View style={styles.actionRow}>
              <View style={styles.actionButton}>
                <Button
                  label="dashboard.action.calendar"
                  variant="secondary"
                  icon="calendar-today"
                  onPress={() => openShift({ name: 'calendar' })}
                  testID="dashboard-open-calendar"
                />
              </View>
              <View style={styles.actionButton}>
                <Pressable
                  onPress={() => openShift({ name: 'swaps' })}
                  onFocus={() => setSwapsFocused(true)}
                  onBlur={() => setSwapsFocused(false)}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={
                    pendingCountKnown
                      ? t('dashboard.action.swapsPending', { count: pendingSwapsData.count })
                      : t('swap.list.title')
                  }
                  testID="dashboard-open-swaps"
                  style={({ pressed }) => [
                    styles.swapsAction,
                    {
                      backgroundColor: colors['color-secondary-container'],
                      borderColor: swapsFocused
                        ? colors['color-on-secondary-container']
                        : colors['color-secondary-container'],
                      opacity: pressed ? 1 - state.pressed : 1,
                    },
                  ]}
                >
                  <MaterialIcons
                    name="sync"
                    size={iconSize('label-large')}
                    color={colors['color-on-secondary-container']}
                    accessibilityElementsHidden
                  />
                  <Text
                    variant="label-large"
                    style={[styles.actionLabel, { color: colors['color-on-secondary-container'] }]}
                  >
                    {t('swap.list.title')}
                  </Text>
                  {showPendingBadge ? (
                    <View
                      style={styles.pendingCountBadge}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      <Text variant="label-small" style={{ color: colors['color-on-warning-container'] }}>
                        {pendingBadgeText}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              </View>
            </View>

            {/* 3. Section: Pending Swaps (Owner / Manager only; hidden at zero) */}
            {isManagerOrOwner && pendingSwapsData.count > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text variant="title-medium" style={styles.sectionTitle}>
                    {t('dashboard.pendingSwaps.title')}
                  </Text>
                  <Text variant="label-medium" tone="secondary">
                    {pendingSwapsData.count === 1
                      ? t('dashboard.pendingSwaps.countSingle')
                      : t('dashboard.pendingSwaps.count', { count: pendingSwapsData.count })}
                  </Text>
                </View>

                <View style={styles.cardList}>
                  {pendingSwapsData.items.map((swap) => {
                    const shiftTimeText = (swap.shiftStartsAt && swap.shiftEndsAt)
                      ? `${formatShiftDay(swap.shiftStartsAt)} ${formatShiftTimeRange(swap.shiftStartsAt, swap.shiftEndsAt)}`
                      : '';
                    return (
                      <Card key={swap.id} variant="flat" testID={`dashboard-pending-swap-${swap.id}`}>
                        <Pressable
                          onPress={() => openShift({ name: 'swaps' })}
                          accessibilityRole="button"
                          accessibilityLabel={[
                            swap.shiftLabel ?? t('teams.view.shift.heading'),
                            t('swap.status.pending'),
                            shiftTimeText,
                            `${swap.requesterName ?? t('activity.system')} to ${swap.targetName ?? t('swap.colleague.open')}`,
                          ]
                            .filter(Boolean)
                            .join(', ')}
                          style={styles.swapPressable}
                        >
                          <View style={styles.swapHeaderRow}>
                            <Text variant="title-small" numberOfLines={1} style={styles.swapTitle}>
                              {swap.shiftLabel ?? t('teams.view.shift.heading')}
                            </Text>
                            <Badge label="swap.status.pending" tone="warning" />
                          </View>
                          {shiftTimeText ? (
                            <Text variant="body-small" tone="secondary">
                              {shiftTimeText}
                            </Text>
                          ) : null}
                          <Text variant="body-small" tone="secondary">
                            {swap.requesterName ?? t('activity.system')} &rarr;{' '}
                            {swap.targetName ?? t('swap.colleague.open')}
                          </Text>
                        </Pressable>
                      </Card>
                    );
                  })}
                  {pendingSwapsData.count > 3 ? (
                    <Button
                      label="dashboard.pendingSwaps.viewAll"
                      variant="ghost"
                      onPress={() => openShift({ name: 'swaps' })}
                      testID="dashboard-view-all-swaps"
                    />
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* 4. Section: Your Next Shift */}
            <View style={styles.section}>
              <Text variant="title-medium" style={styles.sectionTitle}>
                {t('dashboard.nextShift.title')}
              </Text>

              {calendarQuery.isLoading ? (
                <Skeleton variant="block" style={{ height: 76 }} />
              ) : calendarQuery.isError ? (
                <Card style={styles.cardPadding}>
                  <Text variant="body-medium" tone="error" style={styles.errorText}>
                    {t('dashboard.card.error')}
                  </Text>
                  <Button
                    label="dashboard.card.retry"
                    variant="secondary"
                    fullWidth={false}
                    onPress={() => void calendarQuery.refetch()}
                  />
                </Card>
              ) : nextShift === null ? (
                <Card style={styles.cardPadding}>
                  <EmptyState kind="empty" titleKey="dashboard.nextShift.empty" hideBody={compact} />
                </Card>
              ) : (
                <ShiftCard
                  shift={{
                    role: nextShift.label,
                    day: formatShiftDay(nextShift.startsAt),
                    time: formatShiftTimeRange(nextShift.startsAt, nextShift.endsAt),
                    member: currentUserName,
                  }}
                  onPress={() => openShift({ name: 'detail', shiftId: nextShift.id })}
                  testID="dashboard-next-shift-card"
                />
              )}
            </View>

            {/* 5. Section: Your Week */}
            {calendarQuery.isLoading || calendarQuery.isError || weekCount > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text variant="title-medium" style={styles.sectionTitle}>
                    {t('dashboard.thisWeek.title')}
                  </Text>
                  {!calendarQuery.isLoading && !calendarQuery.isError && weekCount > 0 ? (
                    <Text variant="label-medium" tone="secondary">
                      {weekCount === 1
                        ? t('dashboard.thisWeek.countSingle')
                        : t('dashboard.thisWeek.count', { count: weekCount })}
                    </Text>
                  ) : null}
                </View>

                {calendarQuery.isLoading ? (
                  <Skeleton variant="block" style={{ height: 76 }} />
                ) : calendarQuery.isError ? (
                  <Card style={styles.cardPadding}>
                    <Text variant="body-medium" tone="error" style={styles.errorText}>
                      {t('dashboard.card.error')}
                    </Text>
                    <Button
                      label="dashboard.card.retry"
                      variant="secondary"
                      fullWidth={false}
                      onPress={() => void calendarQuery.refetch()}
                    />
                  </Card>
                ) : (
                  <View style={styles.cardList}>
                    {weekShifts.map((shift: ShiftView) => (
                      <ShiftCard
                        key={shift.id}
                        shift={{
                          role: shift.label,
                          day: formatShiftDay(shift.startsAt),
                          time: formatShiftTimeRange(shift.startsAt, shift.endsAt),
                          member: currentUserName,
                        }}
                        onPress={() => openShift({ name: 'detail', shiftId: shift.id })}
                        testID={`dashboard-week-shift-${shift.id}`}
                      />
                    ))}
                  </View>
                )}
              </View>
            ) : null}

            {/* 6. Section: Recent Activity (Everyone) */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text variant="title-medium" style={styles.sectionTitle}>
                  {t('dashboard.activity.title')}
                </Text>
              </View>

              {activityQuery.isLoading ? (
                <Skeleton variant="block" style={{ height: 76 }} />
              ) : activityQuery.isError ? (
                <Card style={styles.cardPadding}>
                  <Text variant="body-medium" tone="error" style={styles.errorText}>
                    {t('dashboard.card.error')}
                  </Text>
                  <Button
                    label="dashboard.card.retry"
                    variant="secondary"
                    fullWidth={false}
                    onPress={() => void activityQuery.refetch()}
                  />
                </Card>
              ) : recentActivity.length === 0 ? (
                <Card style={styles.cardPadding}>
                  <EmptyState
                    kind="empty"
                    titleKey="dashboard.activity.empty"
                    bodyKey="activity.empty.body"
                    hideBody={compact}
                  />
                </Card>
              ) : (
                <View style={styles.cardList}>
                  {recentActivity.map((event) => {
                    const shiftId = activityEventShiftId(event);
                    const onPress = shiftId === null ? undefined : () => openShift({ name: 'detail', shiftId, viewOnly: true });
                    const pressProps = onPress !== undefined ? { onPress } : {};
                    return <ActivityRow key={event.id} event={event} {...pressProps} />;
                  })}
                </View>
              )}
              <View style={styles.activityViewAll}>
                <Button
                  label="dashboard.activity.viewAll"
                  variant="secondary"
                  onPress={() => openShift({ name: 'activity' })}
                  testID="dashboard-view-all-activity"
                />
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors['color-surface'],
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    padding: Number(spacing.base),
    paddingBottom: Number(spacing.veryLarge),
  },
  content: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
  },
  header: {
    marginBottom: spacing.medium,
    gap: spacing.extraSmall,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Number(spacing.base),
  },
  greetingTitle: {
    flexShrink: 1,
  },
  identityCard: {
    borderWidth: HAIRLINE,
    borderColor: colors['color-outline-variant'],
    backgroundColor: colors['color-primary-container'],
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.small,
  },
  identityText: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  teamLabel: {
    flexShrink: 1,
    minWidth: 0,
  },
  teamsButton: {
    flexShrink: 0,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.small,
    marginBottom: spacing.large,
  },
  actionButton: {
    flex: 1,
  },
  swapsAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.small,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.large,
    paddingVertical: spacing.medium,
    borderRadius: shape.medium,
    borderWidth: RING,
    alignSelf: 'stretch',
  },
  actionLabel: {
    flexShrink: 1,
  },
  pendingCountBadge: {
    minWidth: spacing.large,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.extraSmall,
    borderRadius: shape.full,
    backgroundColor: colors['color-warning-container'],
  },
  section: {
    marginBottom: spacing.large,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.small,
  },
  sectionTitle: {
    marginBottom: spacing.small,
  },
  cardList: {
    gap: spacing.small,
  },
  swapPressable: {
    gap: spacing.extraSmall,
  },
  swapHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.small,
  },
  swapTitle: {
    flexShrink: 1,
  },
  activityViewAll: {
    marginTop: spacing.small,
  },
  cardPadding: {
    padding: spacing.medium,
    alignItems: 'center',
    gap: spacing.small,
  },
  errorText: {
    textAlign: 'center',
  },
});
