// TeamSettingsScreen — team administration settings (PRD 4, 6.1; rules U5, U7, X3, S5).
// Reachable ONLY by the team Admin (role === 'owner').
// Contains:
//   1. "Managers can revoke invitations" toggle
//   2. Admin explanation: "The Admin cannot leave the team. Transfer the Admin role or delete the team first."
//   3. "Transfer Admin role" action and modal
//   4. Danger zone: short warning line and "Delete team" action and modal
// Destructive operations decommission the team and return immediately to Your teams (U1).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Switch, View, type TextInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, EmptyState, LiveRegion, Skeleton, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { ApiError, errorMessageKey, teamsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { useTeam, useTeamMembers, useTeams } from '../../state/teams';
import { useTeamsView } from '../../state/teams-view';
import { colors, shape, spacing } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../../theme/layout';
import { DeleteTeamModal } from './DeleteTeamModal';
import { TransferOwnershipModal } from './TransferOwnershipModal';
import { handleTeamDecommissioned } from '../../lib/team-lifecycle';

export function TeamSettingsScreen() {
  const headingRef = useRef<TextInstance>(null);
  const queryClient = useQueryClient();
  const back = useTeamsView((state) => state.back);
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const teamQuery = useTeam(selectedTeamId);
  const membersQuery = useTeamMembers(selectedTeamId);

  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState<MessageKey | null>(null);
  const [transferModalVisible, setTransferModalVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);

  const team = teamQuery.data;
  const members = membersQuery.data?.members;
  const isOwner = team?.role === 'owner';

  useEffect(() => {
    focusOn(headingRef.current);
  }, []);

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['teams'] });
  };

  const handleTransfer = async (targetUserId: string): Promise<void> => {
    if (selectedTeamId === null) return;
    setBusy(true);
    try {
      await teamsApi.transferTeam(selectedTeamId, { targetUserId });
      setTransferModalVisible(false);
      handleTeamDecommissioned(queryClient, selectedTeamId, {
        message: 'teams.toast.transferred',
      });
    } catch (error) {
      setAnnouncement(error instanceof ApiError ? errorMessageKey(error.code) : 'generic.error');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (confirmName: string): Promise<void> => {
    if (selectedTeamId === null) return;
    setBusy(true);
    try {
      await teamsApi.deleteTeam(selectedTeamId, { confirmName });
      setDeleteModalVisible(false);
      handleTeamDecommissioned(queryClient, selectedTeamId, {
        message: 'teams.toast.deleted',
      });
    } catch (error) {
      setAnnouncement(error instanceof ApiError ? errorMessageKey(error.code) : 'generic.error');
    } finally {
      setBusy(false);
    }
  };

  const run = async (action: () => Promise<unknown>, message: MessageKey): Promise<void> => {
    setBusy(true);
    try {
      await action();
      await invalidate();
      setAnnouncement(message);
    } catch (error) {
      setAnnouncement(error instanceof ApiError ? errorMessageKey(error.code) : 'generic.error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="team-settings-screen">
      <View style={styles.container}>
        <View style={styles.content}>
          <Text ref={headingRef} variant="headline-small" accessibilityRole="header">
            {t('teams.view.settings.heading')}
          </Text>
          {team !== undefined ? <Text variant="title-medium">{team.name}</Text> : null}

          {teamQuery.isLoading ? (
            <Skeleton variant="text" />
          ) : teamQuery.isError ? (
            <EmptyState kind="error" action={{ label: 'action.retry', onPress: () => void teamQuery.refetch() }} />
          ) : !isOwner ? (
            <EmptyState
              kind="empty"
              titleKey="generic.error"
              bodyKey="teams.settings.adminOnly"
              action={{ label: 'action.back', onPress: back }}
            />
          ) : (
            <>
              {/* 1. Toggle: Managers can revoke invitations */}
              <Card variant="flat">
                <View style={styles.row}>
                  <Text variant="body-medium" style={styles.settingsLabel}>
                    {t('teams.settings.managersCanRevoke')}
                  </Text>
                  <Switch
                    value={team?.managersCanRevokeInvites ?? false}
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

              {/* 2. Admin transfer role section & explanatory note */}
              <Card variant="flat" style={styles.transferCard}>
                <Text variant="body-medium" tone="secondary" testID="settings-owner-leave-note">
                  {t('teams.leave.blocked')}
                </Text>
                <Button
                  label="teams.transfer.action"
                  variant="secondary"
                  icon="swap-horiz"
                  onPress={() => setTransferModalVisible(true)}
                  testID="settings-transfer-ownership"
                />
              </Card>

              {/* 3. Clearly separated danger section with warning line */}
              <View style={styles.dangerSection} testID="settings-danger-section">
                <Text variant="title-medium" tone="error">
                  {t('teams.settings.dangerZone')}
                </Text>
                <Text variant="body-medium" tone="secondary" testID="settings-danger-warning">
                  {t('teams.settings.dangerWarning')}
                </Text>
                <Button
                  label="teams.delete.action"
                  variant="danger"
                  icon="delete"
                  onPress={() => setDeleteModalVisible(true)}
                  testID="settings-delete-team"
                />
              </View>
            </>
          )}

          <Button label="action.back" variant="ghost" onPress={back} testID="settings-back" />
          {announcement !== null ? <LiveRegion>{announcement}</LiveRegion> : null}
        </View>
      </View>

      <TransferOwnershipModal
        visible={transferModalVisible}
        members={members ?? []}
        busy={busy}
        onConfirm={handleTransfer}
        onCancel={() => setTransferModalVisible(false)}
      />
      <DeleteTeamModal
        visible={deleteModalVisible}
        teamName={team?.name ?? ''}
        busy={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteModalVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors['color-surface'] },
  container: { flex: 1, alignItems: 'center', padding: Number(spacing.base) },
  content: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, gap: Number(spacing.base) },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Number(spacing.base) },
  settingsLabel: { flexShrink: 1 },
  transferCard: { gap: Number(spacing.small) },
  dangerSection: {
    borderWidth: 1,
    borderColor: colors['color-error-container'],
    backgroundColor: colors['color-surface-container'],
    borderRadius: shape.large,
    padding: Number(spacing.base),
    gap: Number(spacing.small),
  },
});

