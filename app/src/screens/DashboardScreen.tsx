// DashboardScreen — Phase 8 Stages A & B (rules U1, U2, U5, U8, X1, X2, X6; PRD 6.1, 8.3, 8.5, 12).
// Signed-in home view for the active team:
// 1. Team identity shell (name, role badge, switch team trigger, "Updated HH:MM" freshness).
// 2. Quick navigation shortcuts (Calendar, Activity).
// 3. "Your next shift" card (first upcoming / in-progress shift, loading, empty, error states).
// 4. "This week" card (shifts in current week + count, loading, empty, error states).
// 5. "Pending swaps" card (Owner/Manager only; count + up to 3 rows; tap opens swaps list).
// 6. "Recent activity" card (latest 5 events for everyone).
// 7. Pull-to-refresh (RefreshControl refetches calendar, swaps, activity; updates freshness).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type TextInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import type { ShiftView } from '@rowta/shared';
import { Badge, Button, Card, EmptyState, ShiftCard, Skeleton, Text } from '../components';
import { t, type MessageKey } from '../i18n/en';
import { authApi, shiftsApi, swapsApi } from '../lib/api';
import { focusOn } from '../lib/a11y';
import { formatShiftDay, formatShiftTimeRange } from '../lib/shift-time';
import {
  canViewPendingSwaps,
  filterThisWeekShifts,
  formatLastUpdatedTime,
  getDashboardCalendarRange,
  getLatestUpdatedTimestamp,
  pickNextShift,
  pickPendingSwaps,
  pickRecentActivity,
} from '../lib/dashboard-shifts';
import { useTeams, useTeamsList } from '../state/teams';
import { useShiftNav } from '../state/shift-nav';
import { ActivityRow } from './shifts/ActivityRow';
import { colors, spacing } from '../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../theme/layout';

const ROLE_LABEL: Record<string, MessageKey> = {
  owner: 'role.owner',
  manager: 'role.manager',
  staff: 'role.staff',
};

const ROLE_TONE: Record<string, 'primary' | 'neutral'> = {
  owner: 'primary',
  manager: 'neutral',
  staff: 'neutral',
};

export function DashboardScreen() {
  const headingRef = useRef<TextInstance>(null);
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const setPickingTeam = useTeams((state) => state.setPickingTeam);
  const openShift = useShiftNav((state) => state.open);

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.me(),
    staleTime: 5 * 60 * 1000,
  });

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
    queryKey: ['swaps', selectedTeamId, 'pending'],
    queryFn: () => swapsApi.listSwaps(selectedTeamId as string, { status: 'pending', limit: 20 }),
    enabled: selectedTeamId !== null && isManagerOrOwner,
  });

  // 3. Recent activity query (latest 5 events for everyone)
  const activityQuery = useQuery({
    queryKey: ['shifts', selectedTeamId, 'activity', { limit: 5 }],
    queryFn: () => shiftsApi.listActivity(selectedTeamId as string, undefined, 5),
    enabled: selectedTeamId !== null,
  });

  useEffect(() => {
    focusOn(headingRef.current);
  }, []);

  const currentUserId = meQuery.data?.userId ?? '';
  const currentUserName = meQuery.data?.displayName ?? '';
  const shifts = calendarQuery.data?.shifts ?? [];

  // Derive "Your next shift" and "This week" using pure helpers
  const nextShift = useMemo(() => pickNextShift(shifts, currentUserId), [shifts, currentUserId]);
  const thisWeekData = useMemo(
    () => filterThisWeekShifts(shifts, currentUserId, range.weekStart, range.weekEnd),
    [shifts, currentUserId, range.weekStart, range.weekEnd],
  );

  // Derive pending swaps data
  const pendingSwapsData = useMemo(
    () => pickPendingSwaps(swapsQuery.data?.swaps ?? []),
    [swapsQuery.data?.swaps],
  );

  // Derive recent activity events
  const recentActivity = useMemo(
    () => pickRecentActivity(activityQuery.data?.events ?? []),
    [activityQuery.data?.events],
  );

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
          <View style={styles.content}>
            {/* 1. Header: Team name, role badge, last updated, switch team */}
            <View style={styles.header}>
              <View style={styles.titleRow}>
                <Text ref={headingRef} variant="headline-small" style={styles.teamTitle} numberOfLines={2}>
                  {selectedTeam?.name ?? t('dashboard.title')}
                </Text>
                <Badge label={ROLE_LABEL[role] ?? 'role.staff'} tone={ROLE_TONE[role] ?? 'neutral'} />
              </View>

              <View style={styles.metaRow}>
                {updatedTime ? (
                  <Text variant="body-small" tone="secondary">
                    {t('dashboard.lastUpdated', { time: updatedTime })}
                  </Text>
                ) : (
                  <View />
                )}
                <Button
                  label="dashboard.switchTeam"
                  variant="ghost"
                  fullWidth={false}
                  onPress={() => setPickingTeam(true)}
                  testID="dashboard-switch-team"
                />
              </View>
            </View>

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
                <Button
                  label="dashboard.action.activity"
                  variant="secondary"
                  icon="history"
                  onPress={() => openShift({ name: 'activity' })}
                  testID="dashboard-open-activity"
                />
              </View>
            </View>

            {/* 3. Section: Pending Swaps (Owner / Manager only) */}
            {isManagerOrOwner ? (
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text variant="title-medium" style={styles.sectionTitle}>
                    {t('dashboard.pendingSwaps.title')}
                  </Text>
                  {pendingSwapsData.count > 0 ? (
                    <Text variant="label-medium" tone="secondary">
                      {pendingSwapsData.count === 1
                        ? t('dashboard.pendingSwaps.countSingle')
                        : t('dashboard.pendingSwaps.count', { count: pendingSwapsData.count })}
                    </Text>
                  ) : null}
                </View>

                {swapsQuery.isLoading ? (
                  <Skeleton variant="block" style={{ height: 76 }} />
                ) : swapsQuery.isError ? (
                  <Card style={styles.cardPadding}>
                    <Text variant="body-medium" tone="error" style={styles.errorText}>
                      {t('dashboard.card.error')}
                    </Text>
                    <Button
                      label="dashboard.card.retry"
                      variant="secondary"
                      fullWidth={false}
                      onPress={() => void swapsQuery.refetch()}
                    />
                  </Card>
                ) : pendingSwapsData.count === 0 ? (
                  <Card style={styles.cardPadding}>
                    <EmptyState kind="empty" titleKey="dashboard.pendingSwaps.empty" />
                  </Card>
                ) : (
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
                )}
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
                  <EmptyState kind="empty" titleKey="dashboard.nextShift.empty" />
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

            {/* 5. Section: This Week */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text variant="title-medium" style={styles.sectionTitle}>
                  {t('dashboard.thisWeek.title')}
                </Text>
                {thisWeekData.count > 0 ? (
                  <Text variant="label-medium" tone="secondary">
                    {thisWeekData.count === 1
                      ? t('dashboard.thisWeek.countSingle')
                      : t('dashboard.thisWeek.count', { count: thisWeekData.count })}
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
              ) : thisWeekData.count === 0 ? (
                <Card style={styles.cardPadding}>
                  <EmptyState kind="empty" titleKey="dashboard.thisWeek.empty" />
                </Card>
              ) : (
                <View style={styles.cardList}>
                  {thisWeekData.shifts.map((shift: ShiftView) => (
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
                  <EmptyState kind="empty" titleKey="dashboard.activity.empty" bodyKey="activity.empty.body" />
                </Card>
              ) : (
                <View style={styles.cardList}>
                  {recentActivity.map((event) => (
                    <ActivityRow key={event.id} event={event} />
                  ))}
                  <Button
                    label="dashboard.activity.viewAll"
                    variant="ghost"
                    onPress={() => openShift({ name: 'activity' })}
                    testID="dashboard-view-all-activity"
                  />
                </View>
              )}
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.small,
  },
  teamTitle: {
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.small,
    marginBottom: spacing.large,
  },
  actionButton: {
    flex: 1,
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
  cardPadding: {
    padding: spacing.medium,
    alignItems: 'center',
    gap: spacing.small,
  },
  errorText: {
    textAlign: 'center',
  },
});
