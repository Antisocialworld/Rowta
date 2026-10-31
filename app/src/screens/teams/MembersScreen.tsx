// MembersScreen — the selected team's members (rules U5, U7, X3, S5; PRD 6.1 line 64, 8.2).
// Rows carry name, email and a role badge. The viewer's role comes from the SERVER's team response
// (team.role — S5), never derived on the phone. Role changes and the settings toggle are Owner-only;
// removals and role changes are offered for non-owner members. Leave team is offered to everyone
// EXCEPT the owner, whose catalog line explains why (teams.leave.blocked). Every destructive action
// goes through the kit's ConfirmDialog (no silent destructive taps); results are announced in a
// polite live region (X3) and never leak raw server text (V5).
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type TextInstance } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, ConfirmDialog, EmptyState, LiveRegion, Skeleton, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { ApiError, errorMessageKey, teamsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { membersNeedingEmail } from '../../lib/member-display';
import {
  canChangeMemberRole,
  canInviteMembers,
  canRemoveMember,
} from '../../lib/team-role';
import { useTeam, useTeamMembers, useTeams } from '../../state/teams';
import { useTeamsView } from '../../state/teams-view';
import { useShiftNav } from '../../state/shift-nav';
import { spacing } from '../../theme/tokens';
import { TeamScreenLayout } from './TeamScreenLayout';

const ROLE_LABEL: Record<string, MessageKey> = { owner: 'role.owner', manager: 'role.manager', staff: 'role.staff' };
const ROLE_TONE: Record<string, 'primary' | 'neutral'> = { owner: 'primary', manager: 'neutral', staff: 'neutral' };

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
  const teamQuery = useTeam(selectedTeamId, { refetchInterval: 15_000, refetchIntervalInBackground: false });
  const membersQuery = useTeamMembers(selectedTeamId, { refetchInterval: 15_000, refetchIntervalInBackground: false });
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState<MessageKey | null>(null);

  const team = teamQuery.data;
  const members = membersQuery.data?.members;
  const isOwner = team?.role === 'owner';
  const isStaff = team?.role === 'staff';

  const duplicateNameUserIds = useMemo(
    () => (members ? membersNeedingEmail(members) : new Set<string>()),
    [members],
  );

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
    <TeamScreenLayout testID="team-members-screen">
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
                const showRoleButton = canChangeMemberRole(team?.role, member.role);
                const showRemoveButton = canRemoveMember(team?.role, member.role);
                const hasActions = showRoleButton || showRemoveButton;
                const showEmail = !isStaff && Boolean(member.email) && duplicateNameUserIds.has(member.userId);
                return (
                  <Card key={member.userId} variant="flat" testID={`member-${member.userId}`}>
                    <View style={styles.row}>
                      <View style={styles.rowText}>
                        <Text variant="title-medium">{member.displayName}</Text>
                        {showEmail ? (
                          <Text variant="body-medium" tone="secondary">
                            {member.email}
                          </Text>
                        ) : null}
                        <Badge label={ROLE_LABEL[member.role] ?? 'role.staff'} tone={ROLE_TONE[member.role] ?? 'neutral'} />
                      </View>
                      {hasActions ? (
                        <View style={styles.rowActions}>
                          {showRoleButton ? (
                            <Button
                              label={member.role === 'manager' ? 'teams.confirm.role.staff' : 'teams.confirm.role.manager'}
                              variant="ghost"
                              fullWidth={false}
                              onPress={() =>
                                setPending({ kind: 'role', userId: member.userId, role: member.role === 'manager' ? 'staff' : 'manager' })
                              }
                              testID={`member-role-${member.userId}`}
                            />
                          ) : null}
                          {showRemoveButton ? (
                            <Button
                              label="action.removeMember"
                              variant="danger"
                              fullWidth={false}
                              onPress={() => setPending({ kind: 'remove', userId: member.userId })}
                              testID={`member-remove-${member.userId}`}
                            />
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  </Card>
                );
              })}
            </View>
          )}
          {canInviteMembers(team?.role) && selectedTeamId !== null ? (
            <Button label="action.invitePeople" icon="person-add" onPress={() => go('invite')} testID="members-open-invite" />
          ) : null}
          {team?.role === 'manager' && team !== undefined ? (
            <View style={styles.row} testID="settings-managers-can-revoke-readonly">
              <Text variant="body-medium" tone="secondary">
                {t(team.managersCanRevokeInvites ? 'teams.settings.managersCanRevokeEnabled' : 'teams.settings.managersCanRevokeDisabled')}
              </Text>
            </View>
          ) : null}
          {!isOwner && selectedTeamId !== null ? (
            <Button label="action.leaveTeam" variant="danger" onPress={() => setPending({ kind: 'leave' })} testID="members-leave" />
          ) : null}
          <Button label="action.back" variant="ghost" onPress={back} />
          {announcement !== null ? (
            <LiveRegion>{announcement}</LiveRegion>
          ) : null}
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
    </TeamScreenLayout>
  );
}

const styles = StyleSheet.create({
  list: { gap: Number(spacing.medium) },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Number(spacing.base) },
  rowText: { flexDirection: 'column', gap: Number(spacing.extraSmall), flexShrink: 1 },
  rowActions: { flexDirection: 'row', gap: Number(spacing.small), flexShrink: 0 },
  entryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Number(spacing.small) },
  settingsLabel: { flexShrink: 1 },
});
