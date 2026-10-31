// TeamListScreen — the signed-in HOME for Phase 3 (rules U2, U5, U7, X3; PRD 6.1, 8.2): the team
// list + role-aware switcher, the create-team entry, the ALWAYS-shown invite-accept result card
// (decisions 1-3), and the Phase 1 placeholder actions (gallery, sign out) so nothing regresses.
// States: loading (Skeleton), error (EmptyState kind=error + retry), empty (EmptyState + create
// CTA), ready (one Card per team). Every string is a catalog key (U8); the server list is the only
// source of truth (S5).
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, LiveRegion, Skeleton, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { ApiError, authApi, teamsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { devToolsVisible } from '../../lib/dev-tools';
import { formatSignedInUserName } from '../../lib/user-name';
import { canInviteMembers, canManageTeamSettings, teamRoleKey } from '../../lib/team-role';
import { useAuthFlow } from '../../state/auth-context';
import { useAuthSession } from '../../state/auth-session';
import { calculateDaysLeftToRestore, resolveSelectedTeamId, useDeletedTeams, useTeams, useTeamsList } from '../../state/teams';
import { useTeamsView } from '../../state/teams-view';
import { useShiftNav } from '../../state/shift-nav';
import { colors, spacing } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../../theme/layout';
import { InviteResultCard } from './InviteResultCard';

const ROLE_LABEL: Record<string, MessageKey> = { owner: 'role.owner', manager: 'role.manager', staff: 'role.staff' };
const ROLE_TONE: Record<string, 'primary' | 'neutral'> = { owner: 'primary', manager: 'neutral', staff: 'neutral' };

export function TeamListScreen() {
  const headingRef = useRef<TextInstance>(null);
  const queryClient = useQueryClient();
  const signOut = useAuthSession((state) => state.signOut);
  const openGallery = useAuthSession((state) => state.openGallery);
  const go = useTeamsView((state) => state.go);
  const openShift = useShiftNav((state) => state.open);
  const teamsQuery = useTeamsList({ refetchInterval: 60_000 });
  const message = useTeamsView((state) => state.message);
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const selectTeam = useTeams((state) => state.selectTeam);
  const inviteResult = useTeams((state) => state.inviteResult);
  const setInviteResult = useTeams((state) => state.setInviteResult);
  const consumeInviteToken = useTeams((state) => state.consumeInviteToken);
  const [retryBusy, setRetryBusy] = useState(false);
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<MessageKey | null>(null);

  const deletedTeamsQuery = useDeletedTeams();
  const deletedTeams = deletedTeamsQuery.data?.teams;

  const handleRestore = async (teamId: string): Promise<void> => {
    setRestoreBusyId(teamId);
    try {
      await teamsApi.restoreTeam(teamId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['teams', 'list'] }),
        queryClient.invalidateQueries({ queryKey: ['teams', 'deleted'] }),
      ]);
      setToastMessage('teams.toast.restored');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'team.restoreExpired') {
        setToastMessage('team.restoreExpired');
        await queryClient.invalidateQueries({ queryKey: ['teams', 'deleted'] });
      } else {
        setToastMessage('generic.error');
      }
    } finally {
      setRestoreBusyId(null);
    }
  };

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.me(),
    staleTime: 5 * 60 * 1000,
  });
  const userName = formatSignedInUserName(meQuery.data);

  useEffect(() => {
    focusOn(headingRef.current);
  }, []);

  // The switcher's fallback (B1): preferred team while it is still in the list, else the first team.
  const teams = teamsQuery.data?.teams;
  useEffect(() => {
    if (teams === undefined) return;
    const next = resolveSelectedTeamId(teams, selectedTeamId);
    if (next !== selectedTeamId) selectTeam(next);
  }, [teams, selectedTeamId, selectTeam]);

  const retryAccept = useCallback(() => {
    // The memory token is re-read here (never logged, never displayed — S1/A13).
    const token = useAuthFlow.getState().inviteToken;
    if (token === null) return;
    setRetryBusy(true);
    void consumeInviteToken(token).finally(() => setRetryBusy(false));
  }, [consumeInviteToken]);

  const dismissResult = useCallback(() => {
    setInviteResult(null);
    void queryClient.invalidateQueries({ queryKey: ['teams'] });
  }, [setInviteResult, queryClient]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.content}>
          <View style={styles.headerBlock}>
            <Text ref={headingRef} variant="headline-small" accessibilityRole="header">
              {t('teams.view.list.heading')}
            </Text>
            {userName ? (
              <Text variant="body-medium" tone="secondary" testID="user-display-name">
                {t('teams.user.signedInAs', { name: userName })}
              </Text>
            ) : null}
          </View>
          {message !== undefined ? (
            <Card variant="flat" testID="teams-list-message">
              <Text variant="body-medium">
                {t(message)}
              </Text>
            </Card>
          ) : null}
          {inviteResult !== null ? (
            <InviteResultCard
              result={inviteResult}
              onDismiss={dismissResult}
              onRetry={inviteResult.kind === 'retry' ? retryAccept : undefined}
              retryBusy={retryBusy}
            />
          ) : null}
          {teamsQuery.isLoading ? (
            <Skeleton variant="text" />
          ) : teamsQuery.isError ? (
            <EmptyState
              kind="error"
              action={{ label: 'action.retry', onPress: () => void teamsQuery.refetch() }}
            />
          ) : teams !== undefined && teams.length === 0 ? (
            <EmptyState
              kind="empty"
              titleKey="teams.empty.title"
              bodyKey="teams.empty.body"
              action={{ label: 'action.createTeam', onPress: () => go('createTeam') }}
            />
          ) : (
            <View style={styles.list}>
              {teams?.map((team) => {
                const selected = team.id === selectedTeamId;
                return (
                  <Card key={team.id} variant={selected ? 'raised' : 'flat'} testID={`team-card-${team.id}`}>
                    <View style={styles.row}>
                      <View style={styles.teamInfo}>
                        <View style={styles.rowText}>
                          <Text variant="title-medium">{team.name}</Text>
                          <Badge
                            label={ROLE_LABEL[team.role] ?? 'role.staff'}
                            tone={ROLE_TONE[team.role] ?? 'neutral'}
                            testID={`team-badge-${team.id}`}
                          />
                        </View>
                        <Text variant="body-medium" tone="secondary" testID={`team-role-${team.id}`}>
                          {t(teamRoleKey(team.role))}
                        </Text>
                        {team.createdBy ? (
                          <Text variant="body-small" tone="secondary" testID={`team-creator-${team.id}`}>
                            {t('teams.createdBy', { name: team.createdBy.displayName })}
                          </Text>
                        ) : null}
                      </View>
                      {selected ? (
                        <Text variant="label-medium" tone="primary">
                          {t('teams.selected')}
                        </Text>
                      ) : (
                        <Button
                          label="action.switchTeam"
                          variant="ghost"
                          fullWidth={false}
                          onPress={() => selectTeam(team.id)}
                          testID={`team-select-${team.id}`}
                        />
                      )}
                    </View>
                    {selected ? (
                      <View style={styles.selectedActions}>
                        <View style={styles.rowActions}>
                          <Button
                            label="action.openShifts"
                            variant="primary"
                            icon="calendar-today"
                            fullWidth={false}
                            onPress={() => openShift({ name: 'calendar' })}
                            testID="team-open-shifts"
                          />
                          <Button
                            label="swap.list.title"
                            variant="secondary"
                            icon="sync"
                            fullWidth={false}
                            onPress={() => openShift({ name: 'swaps' })}
                            testID="team-open-swaps"
                          />
                          <Button
                            label="action.openActivity"
                            variant="secondary"
                            icon="history"
                            fullWidth={false}
                            onPress={() => openShift({ name: 'activity' })}
                            testID="team-open-activity"
                          />
                          <Button
                            label="action.openSearch"
                            variant="secondary"
                            icon="search"
                            fullWidth={false}
                            onPress={() => openShift({ name: 'search' })}
                            testID="team-open-search"
                          />
                        </View>
                        <View style={styles.rowActions}>
                          <Button
                            label="action.manageMembers"
                            variant="secondary"
                            fullWidth={false}
                            onPress={() => go('members')}
                            testID="team-open-members"
                          />
                          {team.role === 'owner' ? (
                            <Button
                              label="action.teamSettings"
                              variant="secondary"
                              icon="settings"
                              fullWidth={false}
                              onPress={() => go('teamSettings')}
                              testID="team-open-settings"
                            />
                          ) : null}
                          {canInviteMembers(team.role) ? (
                            <Button
                              label="action.invitePeople"
                              variant="secondary"
                              fullWidth={false}
                              onPress={() => go('invite')}
                              testID="team-open-invite"
                            />
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                  </Card>
                );
              })}
            </View>
          )}
          {deletedTeams && deletedTeams.length > 0 ? (
            <View style={styles.deletedSection} testID="deleted-teams-section">
              <Text variant="title-medium" tone="secondary">
                {t('teams.deleted.heading')}
              </Text>
              {deletedTeams.map((dTeam) => {
                const daysLeft = calculateDaysLeftToRestore(dTeam.restoreUntil);
                const dateFormatted = new Date(dTeam.deletedAt).toLocaleDateString();
                const isBusy = restoreBusyId === dTeam.id;
                return (
                  <Card key={dTeam.id} variant="flat" testID={`deleted-team-card-${dTeam.id}`}>
                    <View style={styles.row}>
                      <View style={styles.teamInfo}>
                        <Text variant="title-medium">{dTeam.name}</Text>
                        <Text variant="body-small" tone="secondary">
                          {t('teams.deletedAt', { date: dateFormatted })}
                        </Text>
                        <Text variant="body-small" tone="secondary">
                          {t('teams.daysLeftToRestore', { count: daysLeft })}
                        </Text>
                      </View>
                      <Button
                        label="teams.restore.action"
                        variant="secondary"
                        fullWidth={false}
                        busy={isBusy}
                        onPress={() => void handleRestore(dTeam.id)}
                        testID={`team-restore-${dTeam.id}`}
                      />
                    </View>
                  </Card>
                );
              })}
            </View>
          ) : null}
          <Button label="action.createTeam" icon="group-add" onPress={() => go('createTeam')} testID="team-create-entry" />
          {devToolsVisible(__DEV__) ? (
            <Button label="gallery.title" icon="widgets" variant="secondary" onPress={openGallery} />
          ) : null}
          <Button label="action.signOut" variant="ghost" onPress={() => { void signOut(); }} />
          {toastMessage !== null ? <LiveRegion>{toastMessage}</LiveRegion> : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors['color-surface'] },
  container: { flex: 1, alignItems: 'center', padding: Number(spacing.base) },
  content: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, gap: Number(spacing.base) },
  headerBlock: { gap: Number(spacing.extraSmall) },
  list: { gap: Number(spacing.base) },
  deletedSection: { gap: Number(spacing.base), marginTop: Number(spacing.small) },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Number(spacing.base) },
  teamInfo: { gap: Number(spacing.extraSmall), flexShrink: 1 },
  rowText: { flexDirection: 'row', alignItems: 'center', gap: Number(spacing.small), flexShrink: 1 },
  selectedActions: { gap: Number(spacing.small), marginTop: Number(spacing.medium) },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Number(spacing.small) },
});
