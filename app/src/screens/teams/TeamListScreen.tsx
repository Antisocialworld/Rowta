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
import { Badge, Button, Card, EmptyState, Skeleton, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { authApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { devToolsVisible } from '../../lib/dev-tools';
import { formatSignedInUserName } from '../../lib/user-name';
import { teamRoleKey } from '../../lib/team-role';
import { useAuthFlow } from '../../state/auth-context';
import { useAuthSession } from '../../state/auth-session';
import { resolveSelectedTeamId, useTeams, useTeamsList } from '../../state/teams';
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
  const teamsQuery = useTeamsList();
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const selectTeam = useTeams((state) => state.selectTeam);
  const inviteResult = useTeams((state) => state.inviteResult);
  const setInviteResult = useTeams((state) => state.setInviteResult);
  const consumeInviteToken = useTeams((state) => state.consumeInviteToken);
  const [retryBusy, setRetryBusy] = useState(false);

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
                        <Text variant="title-medium">{team.name}</Text>
                        <Text variant="body-medium" tone="secondary" testID={`team-role-${team.id}`}>
                          {t(teamRoleKey(team.role))}
                        </Text>
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
                          <Button
                            label="action.invitePeople"
                            variant="secondary"
                            fullWidth={false}
                            onPress={() => go('invite')}
                            testID="team-open-invite"
                          />
                        </View>
                      </View>
                    ) : null}
                  </Card>
                );
              })}
            </View>
          )}
          <Button label="action.createTeam" icon="group-add" onPress={() => go('createTeam')} testID="team-create-entry" />
          {devToolsVisible(__DEV__) ? (
            <Button label="gallery.title" icon="widgets" variant="secondary" onPress={openGallery} />
          ) : null}
          <Button label="action.signOut" variant="ghost" onPress={() => { void signOut(); }} />
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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Number(spacing.base) },
  teamInfo: { gap: Number(spacing.extraSmall), flexShrink: 1 },
  rowText: { flexDirection: 'row', alignItems: 'center', gap: Number(spacing.small), flexShrink: 1 },
  selectedActions: { gap: Number(spacing.small), marginTop: Number(spacing.medium) },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Number(spacing.small) },
});
