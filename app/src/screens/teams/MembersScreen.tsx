// MembersScreen — the selected team's members (rules U5, U7, X3, S5; PRD 6.1 line 64, 8.2).
// Rows carry name, email and a role badge. The viewer's role comes from the SERVER's team response
// (team.role — S5), never derived on the phone. Role changes and the settings toggle are Owner-only;
// removals and role changes are offered for non-owner members. Leave team is offered to everyone
// EXCEPT the owner, whose catalog line explains why (teams.leave.blocked). Every destructive action
// goes through the kit's ConfirmDialog (no silent destructive taps); results are announced in a
// polite live region (X3) and never leak raw server text (V5).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Switch, View, type TextInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, ConfirmDialog, EmptyState, LiveRegion, Skeleton, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { ApiError, errorMessageKey, teamsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { useTeam, useTeamMembers, useTeams } from '../../state/teams';
import { useTeamsView } from '../../state/teams-view';
import { useShiftNav } from '../../state/shift-nav';
import { colors, spacing } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../../theme/layout';

const ROLE_LABEL: Record<string, MessageKey> = { owner: 'role.owner', manager: 'role.manager', staff: 'role.staff' };
const ROLE_TONE: Record<string, 'primary' | 'neutral'> = { owner: 'primary', manager: 'neutral', staff: 'neutral' };
const OWNER_LEAVE_BLOCKED: MessageKey = 'teams.leave.blocked';

type PendingAction =
  | { kind: 'remove'; userId: string }
  | { kind: 'role'; userId: string; role: 'manager' | 'staff' }
  | { kind: 'leave' };

export function MembersScreen() {
  const headingRef = useRef<TextInstance>(null);
  const queryClient = useQueryClient();
  const back = useTeamsView((state) => state.back);
  const go = useTeamsView((state) => state.go);
  const openShift = useShiftNav((state) => state.open);
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const teamQuery = useTeam(selectedTeamId);
  const membersQuery = useTeamMembers(selectedTeamId);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState<MessageKey | null>(null);

  const team = teamQuery.data;
  const members = membersQuery.data?.members;
  const isOwner = team?.role === 'owner';

  useEffect(() => {
    focusOn(headingRef.current);
  }, []);

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['teams'] });
  };

  const run = async (action: () => Promise<unknown>, message: MessageKey, after?: () => void): Promise<void> => {
    setBusy(true);
    try {
      await action();
      await invalidate();
      setAnnouncement(message);
      after?.();
    } catch (error) {
      setAnnouncement(error instanceof ApiError ? errorMessageKey(error.code) : 'generic.error');
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const confirm = (): void => {
    if (pending === null || selectedTeamId === null) return;
    if (pending.kind === 'remove') {
      void run(() => teamsApi.removeMember(selectedTeamId, pending.userId), 'teams.toast.memberRemoved');
    } else if (pending.kind === 'role') {
      void run(
        () => teamsApi.changeMemberRole(selectedTeamId, pending.userId, { role: pending.role }),
        'teams.toast.roleChanged',
      );
    } else if (pending.kind === 'leave') {
      void run(() => teamsApi.leaveTeam(selectedTeamId), 'teams.toast.left', back);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.content}>
          <Text ref={headingRef} variant="headline-small" accessibilityRole="header">
            {t('teams.view.members.heading')}
          </Text>
          {team !== undefined ? <Text variant="title-medium">{team.name}</Text> : null}
          <View style={styles.entryRow}>
            <Button
              label="action.openShifts"
              variant="secondary"
              icon="calendar-today"
              fullWidth={false}
              onPress={() => openShift({ name: 'calendar' })}
              testID="members-open-shifts"
            />
            <Button
              label="swap.list.title"
              variant="secondary"
              icon="sync"
              fullWidth={false}
              onPress={() => openShift({ name: 'swaps' })}
              testID="members-open-swaps"
            />
            <Button
              label="action.openActivity"
              variant="secondary"
              icon="history"
              fullWidth={false}
              onPress={() => openShift({ name: 'activity' })}
              testID="members-open-activity"
            />
            <Button
              label="action.openSearch"
              variant="secondary"
              icon="search"
              fullWidth={false}
              onPress={() => openShift({ name: 'search' })}
              testID="members-open-search"
            />
          </View>
          {membersQuery.isLoading ? (
            <Skeleton variant="text" />
          ) : membersQuery.isError ? (
            <EmptyState kind="error" action={{ label: 'action.retry', onPress: () => void membersQuery.refetch() }} />
          ) : members !== undefined && members.length === 0 ? (
            <EmptyState kind="empty" titleKey="teams.members.empty.title" bodyKey="teams.members.empty.body" />
          ) : (
            <View style={styles.list}>
              {members?.map((member) => {
                const canManage = isOwner && member.role !== 'owner';
                return (
                  <Card key={member.userId} variant="flat" testID={`member-${member.userId}`}>
                    <View style={styles.row}>
                      <View style={styles.rowText}>
                        <Text variant="title-medium">{member.displayName}</Text>
                        <Text variant="body-medium" tone="secondary">
                          {member.email}
                        </Text>
                        <Badge label={ROLE_LABEL[member.role] ?? 'role.staff'} tone={ROLE_TONE[member.role] ?? 'neutral'} />
                      </View>
                      {canManage ? (
                        <View style={styles.rowActions}>
                          <Button
                            label={member.role === 'manager' ? 'teams.confirm.role.staff' : 'teams.confirm.role.manager'}
                            variant="ghost"
                            fullWidth={false}
                            onPress={() =>
                              setPending({ kind: 'role', userId: member.userId, role: member.role === 'manager' ? 'staff' : 'manager' })
                            }
                            testID={`member-role-${member.userId}`}
                          />
                          <Button
                            label="action.removeMember"
                            variant="danger"
                            fullWidth={false}
                            onPress={() => setPending({ kind: 'remove', userId: member.userId })}
                            testID={`member-remove-${member.userId}`}
                          />
                        </View>
                      ) : null}
                    </View>
                  </Card>
                );
              })}
            </View>
          )}
          {selectedTeamId !== null ? (
            <Button label="action.invitePeople" icon="person-add" onPress={() => go('invite')} testID="members-open-invite" />
          ) : null}
          {isOwner && team !== undefined ? (
            <Card variant="flat">
              <View style={styles.row}>
                <Text variant="body-medium" style={styles.settingsLabel}>
                  {t('teams.settings.managersCanRevoke')}
                </Text>
                <Switch
                  value={team.managersCanRevokeInvites}
                  onValueChange={(value) => {
                    if (selectedTeamId === null) return;
                    void run(
                      () => teamsApi.updateTeamSettings(selectedTeamId, { managers_can_revoke_invites: value }),
                      'teams.toast.settingsSaved',
                    );
                  }}
                  accessibilityLabel={t('teams.settings.managersCanRevoke')}
                  testID="settings-managers-can-revoke"
                />
              </View>
            </Card>
          ) : null}
          {!isOwner && selectedTeamId !== null ? (
            <Button label="action.leaveTeam" variant="danger" onPress={() => setPending({ kind: 'leave' })} testID="members-leave" />
          ) : null}
          {isOwner ? (
            <LiveRegion tone="secondary">{OWNER_LEAVE_BLOCKED}</LiveRegion>
          ) : null}
          <Button label="action.back" variant="ghost" onPress={back} />
          {announcement !== null ? (
            <LiveRegion>{announcement}</LiveRegion>
          ) : null}
        </View>
      </View>
      <ConfirmDialog
        visible={pending !== null}
        titleKey={
          pending?.kind === 'remove'
            ? 'teams.confirm.remove.title'
            : pending?.kind === 'role'
              ? 'teams.confirm.role.title'
              : 'teams.confirm.leave.title'
        }
        messageKey={
          pending?.kind === 'remove'
            ? 'teams.confirm.remove.message'
            : pending?.kind === 'role'
              ? 'teams.confirm.role.message'
              : 'teams.confirm.leave.message'
        }
        confirmLabel={pending?.kind === 'leave' ? 'action.leaveTeam' : 'action.confirm'}
        destructive={pending?.kind !== 'role'}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors['color-surface'] },
  container: { flex: 1, alignItems: 'center', padding: Number(spacing.base) },
  content: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, gap: Number(spacing.base) },
  list: { gap: Number(spacing.medium) },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Number(spacing.base) },
  rowText: { flexDirection: 'column', gap: Number(spacing.extraSmall), flexShrink: 1 },
  rowActions: { flexDirection: 'row', gap: Number(spacing.small), flexShrink: 0 },
  entryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Number(spacing.small) },
  settingsLabel: { flexShrink: 1 },
});
