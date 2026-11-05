// ActivityScreen — the team's shift activity feed, cursor paginated (Phase 4; PRD 8.3).
// Infinite scroll calls the SAME guarded "request next page" path as the explicit Load more button:
// the paging gate plus TanStack's isFetchingNextPage mean ten fast onEndReached events produce one
// request, and mergeActivityPages de-duplicates by event id (lib/shift-feed.ts, proven by
// scripts/test-shift-logic.ts). Four states: loading, error, empty, ready.
import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, View, type TextInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Button, ConfirmDialog, EmptyState, LiveRegion, PinnedFooter, PinnedHeader, Skeleton, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { shiftsApi, authApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import {
  activityEventShiftId,
  canRequestNextPage,
  createPagingGate,
  mergeActivityPages,
} from '../../lib/shift-feed';
import { useActivityClearedUntil } from '../../lib/useActivityClearedUntil';
import { teamContextLabel } from '../../lib/team-context';
import { useShiftNav } from '../../state/shift-nav';
import { useTeam, useTeams } from '../../state/teams';
import { colors, spacing } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../../theme/layout';
import { ActivityRow } from './ActivityRow';

const END_KEY: MessageKey = 'activity.end';

export function ActivityScreen() {
  const headingRef = useRef<TextInstance>(null);
  const back = useShiftNav((state) => state.back);
  const open = useShiftNav((state) => state.open);
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const teamQuery = useTeam(selectedTeamId);
  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.me(),
    enabled: selectedTeamId !== null,
  });
  const currentUserId = meQuery.data?.userId ?? '';
  const { clearedUntil, setClearedUntil, isLoaded } = useActivityClearedUntil(currentUserId, selectedTeamId);
  const [confirmVisible, setConfirmVisible] = useState(false);

  const query = useInfiniteQuery({
    queryKey: ['shifts', selectedTeamId, 'activity', clearedUntil],
    queryFn: ({ pageParam }) =>
      shiftsApi.listActivity(selectedTeamId as string, pageParam, undefined, clearedUntil ?? undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: selectedTeamId !== null && isLoaded,
  });
  const fetchRef = useRef(query.fetchNextPage);
  fetchRef.current = query.fetchNextPage;
  const [gate] = useState(() => createPagingGate(() => fetchRef.current()));
  const events = mergeActivityPages((query.data?.pages ?? []).map((page) => page.events));

  useEffect(() => {
    focusOn(headingRef.current);
  }, []);

  const handleClearAll = (): void => {
    setConfirmVisible(true);
  };

  const handleConfirmClear = async (): Promise<void> => {
    if (currentUserId === '' || selectedTeamId === null) return;
    const newest = events[0];
    const clearedUntilValue = newest?.createdAt ?? new Date().toISOString();
    await setClearedUntil(clearedUntilValue);
    setConfirmVisible(false);
  };

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

  const renderFooter = () => {
    return (
      <View style={styles.footerContainer}>
        {query.isFetchingNextPage ? (
          <Skeleton variant="text" />
        ) : query.hasNextPage ? (
          <Button label="action.loadMore" variant="secondary" onPress={requestMore} testID="activity-load-more" />
        ) : (
          <LiveRegion style={styles.visuallyHidden}>{END_KEY}</LiveRegion>
        )}
      </View>
    );
  };

  if (selectedTeamId === null) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.container}>
          <EmptyState kind="error" />
        </View>
      <PinnedFooter label="action.back" onPress={back} variant="secondary" />
    </SafeAreaView>
  );
}

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <Text ref={headingRef} variant="headline-small" accessibilityRole="header">
          {t('teams.view.activity.heading')}
        </Text>
        {teamQuery.data !== undefined ? (
          <Text variant="title-medium">{teamContextLabel(teamQuery.data.name)}</Text>
        ) : null}
        {events.length > 0 ? (
          <PinnedHeader>
            <Button
              label="activity.clearAll.button"
              variant="secondary"
              onPress={handleClearAll}
              testID="activity-clear-all"
            />
          </PinnedHeader>
        ) : null}
        {query.isLoading ? (
          <View style={styles.list}>
            <Skeleton variant="block" />
            <Skeleton variant="block" />
          </View>
        ) : query.isError ? (
          <View style={styles.emptyContainer}>
            <EmptyState kind="error" action={{ label: 'action.retry', onPress: () => void query.refetch() }} />
          </View>
        ) : events.length === 0 ? (
          <View style={styles.emptyContainer}>
            <EmptyState kind="empty" titleKey="activity.empty.title" bodyKey="activity.empty.body" />
          </View>
        ) : (
          <FlatList
            style={styles.list}
            contentContainerStyle={styles.listContent}
            data={events}
            keyExtractor={(event) => event.id}
            renderItem={({ item }) => {
              const shiftId = activityEventShiftId(item);
              const onPress = shiftId === null ? undefined : () => open({ name: 'detail', shiftId, viewOnly: true });
              const pressProps = onPress !== undefined ? { onPress } : {};
              return <ActivityRow event={item} {...pressProps} />;
            }}
            onEndReached={requestMore}
            onEndReachedThreshold={0.4}
            ListFooterComponent={renderFooter}
          />
        )}
      </View>
      <PinnedFooter label="action.back" onPress={back} variant="secondary" />
      <ConfirmDialog
        visible={confirmVisible}
        titleKey="activity.clearAll.title"
        messageKey="activity.clearAll.body"
        confirmLabel="activity.clearAll.button"
        cancelLabel="action.cancel"
        destructive
        busy={false}
        onConfirm={() => {
          void handleConfirmClear();
        }}
        onCancel={() => setConfirmVisible(false)}
        testID="activity-clear-dialog"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors['color-surface'] },
  container: { flex: 1, width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', padding: Number(spacing.base), gap: Number(spacing.base) },
  list: { flex: 1 },
  listContent: { gap: Number(spacing.base), paddingBottom: Number(spacing.veryLarge) },
  footerContainer: { gap: Number(spacing.base), marginTop: Number(spacing.base) },
  emptyContainer: { gap: Number(spacing.base) },
  visuallyHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
});
