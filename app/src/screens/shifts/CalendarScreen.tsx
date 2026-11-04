// CalendarScreen — the next 14 days of shifts for the selected team (Phase 4; PRD 6.1, 8.3).
// Server data only (S5): the range is computed locally, the server decides which shifts overlap it.
// Four states: loading (Skeleton), error (EmptyState + retry), empty (EmptyState), ready (ShiftCard
// rows). Owner/Manager see New shift; every role sees Activity and Search. Shift details open on tap.
import { useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, View, type TextInstance, type ViewInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import type { ShiftView } from '@rowta/shared';
import { Button, EmptyState, ShiftCard, Skeleton, Text } from '../../components';
import { t } from '../../i18n/en';
import { shiftsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { canManageShifts } from '../../lib/shift-access';
import { defaultCalendarRange, formatShiftDay, formatShiftTimeRange } from '../../lib/shift-time';
import { useTeam, useTeamMembers, useTeams } from '../../state/teams';
import { useShiftNav } from '../../state/shift-nav';
import { useSearchModal } from '../../state/search-modal';
import { colors, spacing } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../../theme/layout';

export function shiftCardData(shift: ShiftView, memberName: string) {
  return {
    role: shift.label,
    day: formatShiftDay(shift.startsAt),
    time: formatShiftTimeRange(shift.startsAt, shift.endsAt),
    member: memberName,
  };
}

export function CalendarScreen() {
  const headingRef = useRef<TextInstance>(null);
  const searchTriggerRef = useRef<ViewInstance>(null);
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const teamQuery = useTeam(selectedTeamId);
  const membersQuery = useTeamMembers(selectedTeamId);
  const open = useShiftNav((state) => state.open);
  const back = useShiftNav((state) => state.back);
  const openSearchModal = useSearchModal((state) => state.open);
  const range = useMemo(() => defaultCalendarRange(), []);
  const calendarQuery = useQuery({
    queryKey: ['shifts', selectedTeamId, range.from, range.to],
    queryFn: () => shiftsApi.listCalendar(selectedTeamId as string, range.from, range.to),
    enabled: selectedTeamId !== null,
  });

  useEffect(() => {
    focusOn(headingRef.current);
  }, []);

  const names = new Map((membersQuery.data?.members ?? []).map((member) => [member.userId, member.displayName]));
  const shifts = calendarQuery.data?.shifts ?? [];
  const manager = canManageShifts(teamQuery.data?.role);

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
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text ref={headingRef} variant="headline-small" accessibilityRole="header">
            {t('teams.view.calendar.heading')}
          </Text>
          {teamQuery.data !== undefined ? <Text variant="title-medium">{teamQuery.data.name}</Text> : null}
          {calendarQuery.isLoading ? (
            <View style={styles.list}>
              <Skeleton variant="block" />
              <Skeleton variant="block" />
            </View>
          ) : calendarQuery.isError ? (
            <EmptyState kind="error" action={{ label: 'action.retry', onPress: () => void calendarQuery.refetch() }} />
          ) : shifts.length === 0 ? (
            <EmptyState kind="empty" titleKey="shift.empty.title" bodyKey="shift.empty.body" />
          ) : (
            <View style={styles.list}>
              {shifts.map((shift) => (
                <ShiftCard
                  key={shift.id}
                  shift={shiftCardData(shift, names.get(shift.assignedUserId) ?? '')}
                  onPress={() => open({ name: 'detail', shiftId: shift.id })}
                  testID={`shift-${shift.id}`}
                />
              ))}
            </View>
          )}
          {manager ? (
            <Button label="action.newShift" icon="add" onPress={() => open({ name: 'create' })} testID="shift-create-entry" />
          ) : null}
          <Button label="action.openActivity" icon="history" variant="secondary" onPress={() => open({ name: 'activity' })} />
          <Button
            ref={searchTriggerRef}
            label="action.openSearch"
            icon="search"
            variant="secondary"
            onPress={() => openSearchModal(searchTriggerRef)}
          />
          <Button label="action.back" variant="ghost" onPress={back} />
        </ScrollView>
      </View>
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
  scroll: { flex: 1, width: '100%' },
  content: { gap: Number(spacing.base), paddingBottom: Number(spacing.base) },
  list: { gap: Number(spacing.base) },
});
