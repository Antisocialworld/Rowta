// ShiftDetailScreen — one shift's details and the Owner/Manager actions (Phase 4; PRD 6.1, 8.3).
// The viewer's role comes from the SERVER's team response (S5); the buttons are only a mirror.
// Delete is a soft delete behind the kit's ConfirmDialog, announced in a polite live region, and
// routes back to the calendar. Four states: loading, error, missing, ready.
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type TextInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ConfirmDialog, EmptyState, LiveRegion, Skeleton, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { ApiError, errorMessageKey, shiftsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { canManageShifts } from '../../lib/shift-access';
import { formatShiftDay, formatShiftTimeRange } from '../../lib/shift-time';
import { useShiftNav } from '../../state/shift-nav';
import { useTeam, useTeams } from '../../state/teams';
import { colors, spacing } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../../theme/layout';

export function ShiftDetailScreen() {
  const headingRef = useRef<TextInstance>(null);
  const queryClient = useQueryClient();
  const open = useShiftNav((state) => state.open);
  const back = useShiftNav((state) => state.back);
  const route = useShiftNav((state) => state.route);
  const shiftId = route?.name === 'detail' ? route.shiftId : null;
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const teamQuery = useTeam(selectedTeamId);
  const shiftQuery = useQuery({
    queryKey: ['shifts', selectedTeamId, 'detail', shiftId],
    queryFn: () => shiftsApi.getShift(selectedTeamId as string, shiftId as string),
    enabled: selectedTeamId !== null && shiftId !== null,
  });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState<MessageKey | null>(null);

  useEffect(() => {
    focusOn(headingRef.current);
  }, []);

  const manager = canManageShifts(teamQuery.data?.role);
  const shift = shiftQuery.data;

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
  actions: { gap: Number(spacing.small) },
});
