// ActivityScreen — the team's shift activity feed, cursor paginated (Phase 4; PRD 8.3).
// Infinite scroll calls the SAME guarded "request next page" path as the explicit Load more button:
// the paging gate plus TanStack's isFetchingNextPage mean ten fast onEndReached events produce one
// request, and mergeActivityPages de-duplicates by event id (lib/shift-feed.ts, proven by
// scripts/test-shift-logic.ts). Four states: loading, error, empty, ready.
import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, View, type TextInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, EmptyState, LiveRegion, Skeleton, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { shiftsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { canRequestNextPage, createPagingGate, mergeActivityPages } from '../../lib/shift-feed';
import { useShiftNav } from '../../state/shift-nav';
import { useTeams } from '../../state/teams';
import { colors, spacing } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../../theme/layout';
import { ActivityRow } from './ActivityRow';

const END_KEY: MessageKey = 'activity.end';

export function ActivityScreen() {
  const headingRef = useRef<TextInstance>(null);
  const back = useShiftNav((state) => state.back);
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const query = useInfiniteQuery({
    queryKey: ['shifts', selectedTeamId, 'activity'],
    queryFn: ({ pageParam }) => shiftsApi.listActivity(selectedTeamId as string, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: selectedTeamId !== null,
  });
  const fetchRef = useRef(query.fetchNextPage);
  fetchRef.current = query.fetchNextPage;
  const [gate] = useState(() => createPagingGate(() => fetchRef.current()));
  const events = mergeActivityPages((query.data?.pages ?? []).map((page) => page.events));

  useEffect(() => {
    focusOn(headingRef.current);
  }, []);

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
        <Button label="action.back" variant="ghost" onPress={back} />
      </View>
    );
  };

  if (selectedTeamId === null) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.container}>
          <EmptyState kind="error" action={{ label: 'action.back', onPress: back }} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <Text ref={headingRef} variant="headline-small" accessibilityRole="header">
          {t('teams.view.activity.heading')}
        </Text>
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
        ) : events.length === 0 ? (
          <View style={styles.emptyContainer}>
            <EmptyState kind="empty" titleKey="activity.empty.title" bodyKey="activity.empty.body" />
            <Button label="action.back" variant="ghost" onPress={back} />
          </View>
        ) : (
          <FlatList
            style={styles.list}
            contentContainerStyle={styles.listContent}
            data={events}
            keyExtractor={(event) => event.id}
            renderItem={({ item }) => <ActivityRow event={item} />}
            onEndReached={requestMore}
            onEndReachedThreshold={0.4}
            ListFooterComponent={renderFooter}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors['color-surface'] },
  container: { flex: 1, width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', padding: Number(spacing.base), gap: Number(spacing.base) },
  list: { flex: 1 },
  listContent: { gap: Number(spacing.base), paddingBottom: Number(spacing.base) },
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
