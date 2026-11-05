// TeamListScreen — the signed-in HOME for Phase 3 (rules U2, U5, U7, X3; PRD 6.1, 8.2): the team
// list + role-aware switcher, the create-team entry, the ALWAYS-shown invite-accept result card
// (decisions 1-3), and the Phase 1 placeholder actions (gallery, sign out) so nothing regresses.
// States: loading (Skeleton), error (EmptyState kind=error + retry), empty (EmptyState + create
// CTA), ready (compact team rows with a selected-team panel). Every string is a catalog key (U8);
// the server list is the only source of truth (S5).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type TextInstance, type ViewInstance } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, EmptyState, LiveRegion, Skeleton, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { ApiError, teamsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { devToolsVisible } from '../../lib/dev-tools';
import { canInviteMembers, canManageTeamSettings, teamRoleKey } from '../../lib/team-role';
import { useAuthFlow } from '../../state/auth-context';
import { useAuthSession } from '../../state/auth-session';
import { resolveSelectedTeamId, useDeletedTeams, useTeams, useTeamsList } from '../../state/teams';
import { useTeamsView } from '../../state/teams-view';
import { useInviteModal } from '../../state/invite-modal';
import { AccountMenu } from '../../components/AccountMenu';
import { colors, shape, spacing, state } from '../../theme/tokens';
import { MIN_TOUCH_TARGET, RING, iconSize } from '../../theme/layout';
import { InviteResultCard } from './InviteResultCard';
import { TeamScreenLayout } from './TeamScreenLayout';
import { DeletedTeamsModal } from './DeletedTeamsModal';
import { CreateTeamModal } from './CreateTeamModal';
import { shouldCloseDeletedTeamsModal, shouldShowDeletedTeamsTrigger } from '../../lib/deleted-teams-logic';

const SHORT_ROLE_KEY: Record<string, MessageKey> = {
  owner: 'role.owner',
  manager: 'role.manager',
  staff: 'role.staff',
};

function TeamRow({
  team,
  selected,
  panelOpen,
  onSelect,
}: {
  team: { id: string; name: string; role: string };
  selected: boolean;
  panelOpen: boolean;
  onSelect: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const shortRole = t(SHORT_ROLE_KEY[team.role] ?? 'role.staff');
  const cue = selected ? t('teams.selected') : t('action.switchTeam');
  const accessibleLabel = [team.name, shortRole, cue].join(', ');
  const handlePress = (): void => {
    onSelect();
  };

  return (
    <Pressable
      testID={`team-select-${team.id}`}
      onPress={handlePress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibleLabel}
      accessibilityState={{ selected, expanded: selected ? panelOpen : undefined }}
      style={({ pressed }) => [
        styles.teamRow,
        {
          borderColor:
            focused || selected ? colors['color-primary'] : colors['color-surface-container'],
        },
        pressed && { opacity: 1 - state.pressed },
      ]}
    >
      <View style={styles.teamRowText}>
        <Text variant="title-medium" numberOfLines={1} style={styles.teamName}>
          {team.name}
        </Text>
        <Text variant="body-small" tone="secondary" testID={`team-role-${team.id}`}>
          {shortRole}
        </Text>
      </View>
      <View style={styles.teamRowCue}>
        {selected ? (
          <Text variant="label-medium" tone="primary">
            {cue}
          </Text>
        ) : (
          <View style={styles.switchPill}>
            <Text variant="label-medium" style={{ color: colors['color-on-secondary-container'] }}>
              {cue}
            </Text>
          </View>
        )}
        {selected ? (
          <MaterialIcons
            name={panelOpen ? 'expand-less' : 'expand-more'}
            size={iconSize('title-medium')}
            color={colors['color-on-surface-variant']}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}
      </View>
    </Pressable>
  );
}

export function TeamListScreen() {
  const headingRef = useRef<TextInstance>(null);
  const queryClient = useQueryClient();
  const openGallery = useAuthSession((state) => state.openGallery);
  const go = useTeamsView((state) => state.go);
  const openInviteModal = useInviteModal((state) => state.open);
  const teamsQuery = useTeamsList({ refetchInterval: 15_000, refetchIntervalInBackground: false });
  const message = useTeamsView((state) => state.message);
  const clearMessage = useTeamsView((state) => state.clearMessage);
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const selectTeam = useTeams((state) => state.selectTeam);
  const setSelectedTeamId = useTeams((state) => state.setSelectedTeamId);
  const pickingTeam = useTeams((state) => state.pickingTeam);
  const setPickingTeam = useTeams((state) => state.setPickingTeam);
  const inviteResult = useTeams((state) => state.inviteResult);
  const setInviteResult = useTeams((state) => state.setInviteResult);
  const consumeInviteToken = useTeams((state) => state.consumeInviteToken);
  const [retryBusy, setRetryBusy] = useState(false);
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<MessageKey | null>(null);
  const [deletedModalOpen, setDeletedModalOpen] = useState(false);
  const deletedTriggerRef = useRef<ViewInstance>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const createTriggerRef = useRef<ViewInstance>(null);
  const inviteTriggerRef = useRef<ViewInstance>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const deletedTeamsQuery = useDeletedTeams();
  const deletedTeams = deletedTeamsQuery.data?.teams;

  useEffect(() => {
    if (deletedModalOpen && deletedTeams !== undefined && shouldCloseDeletedTeamsModal(deletedTeams.length)) {
      setDeletedModalOpen(false);
      focusOn(headingRef.current);
    }
  }, [deletedModalOpen, deletedTeams]);

  const handleCloseDeletedModal = () => {
    setDeletedModalOpen(false);
    if (deletedTriggerRef.current) {
      focusOn(deletedTriggerRef.current);
    } else {
      focusOn(headingRef.current);
    }
  };

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

  useEffect(() => {
    focusOn(headingRef.current);
  }, []);

  useEffect(() => {
    if (message !== 'teams.toast.deleted') return;
    const timer = setTimeout(() => {
      clearMessage();
    }, 4000);
    return () => clearTimeout(timer);
  }, [message, clearMessage]);

  // The switcher's fallback (B1): preferred team while it is still in the list, else the first team.
  const teams = teamsQuery.data?.teams;
  useEffect(() => {
    if (teams === undefined) return;
    const next = resolveSelectedTeamId(teams, selectedTeamId);
    if (next !== selectedTeamId) {
      if (pickingTeam) {
        setSelectedTeamId(next);
      } else {
        selectTeam(next);
      }
    }
  }, [teams, selectedTeamId, selectTeam, pickingTeam, setSelectedTeamId]);

  // Live update on invite acceptance (Task 1): when an invite is accepted, refetch the team list at once
  useEffect(() => {
    if (inviteResult?.kind === 'joined') {
      void queryClient.invalidateQueries({ queryKey: ['teams', 'list'] });
      void queryClient.refetchQueries({ queryKey: ['teams', 'list'] });
    }
  }, [inviteResult, queryClient]);

  const retryAccept = useCallback(() => {
    // The memory token is re-read here (never logged, never displayed — S1/A13).
    const token = useAuthFlow.getState().inviteToken;
    if (token === null) return;
    setRetryBusy(true);
    void consumeInviteToken(token).finally(() => setRetryBusy(false));
  }, [consumeInviteToken]);

  const dismissResult = useCallback(() => {
    setInviteResult(null);
    void queryClient.invalidateQueries({ queryKey: ['teams', 'list'] });
    void queryClient.refetchQueries({ queryKey: ['teams', 'list'] });
    void queryClient.invalidateQueries({ queryKey: ['teams'] });
  }, [setInviteResult, queryClient]);

  const handleOpenMembers = (): void => {
    go('members');
  };

  const handleOpenSettings = (): void => {
    go('teamSettings');
  };

  const handleOpenInvite = (): void => {
    openInviteModal('teamList', inviteTriggerRef);
  };

  const handleTeamPress = (teamId: string, selected: boolean): void => {
    if (selected) {
      setPanelOpen((open) => !open);
      return;
    }
    if (pickingTeam) {
      setSelectedTeamId(teamId);
    } else {
      selectTeam(teamId);
    }
    setPanelOpen(true);
  };

  const backFooter =
    pickingTeam && selectedTeamId !== null ? (
      <Button
        label="action.back"
        variant="secondary"
        onPress={() => setPickingTeam(false)}
        testID="team-list-back"
      />
    ) : undefined;

  return (
    <TeamScreenLayout testID="team-list-screen" footer={backFooter}>
      <View style={styles.topRow}>
        <AccountMenu testID="teams-account-button" />
      </View>
      <View style={styles.headerBlock}>
        <Text ref={headingRef} variant="headline-small" accessibilityRole="header">
          {t('teams.view.list.heading')}
        </Text>
      </View>
      <Button
        ref={createTriggerRef}
        label="action.createTeam"
        icon="group-add"
        onPress={() => setCreateModalOpen(true)}
        testID="team-create-entry"
      />
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
          action={{ label: 'action.createTeam', onPress: () => setCreateModalOpen(true) }}
        />
      ) : (
        <View style={styles.list}>
          {teams?.map((team) => {
            const selected = team.id === selectedTeamId;
            const handleRowPress = (): void => {
              handleTeamPress(team.id, selected);
            };
            return (
              <View key={team.id} testID={`team-card-${team.id}`} style={styles.teamBlock}>
                <TeamRow
                  team={team}
                  selected={selected}
                  panelOpen={panelOpen}
                  onSelect={handleRowPress}
                />
                {selected && panelOpen ? (
                  <Card variant="raised">
                    <Text variant="title-medium">{team.name}</Text>
                    <Text variant="body-medium" tone="secondary">
                      {t(teamRoleKey(team.role))}
                    </Text>
                    {team.createdBy ? (
                      <Text variant="body-small" tone="secondary" testID={`team-creator-${team.id}`}>
                        {t('teams.createdBy', { name: team.createdBy.displayName })}
                      </Text>
                    ) : null}
                    <View style={styles.panelActions}>
                      <Button
                        label="action.manageMembers"
                        variant="secondary"
                        fullWidth={false}
                        onPress={handleOpenMembers}
                        testID="team-open-members"
                      />
                      {canManageTeamSettings(team.role) ? (
                        <Button
                          label="action.teamSettings"
                          variant="secondary"
                          icon="settings"
                          fullWidth={false}
                          onPress={handleOpenSettings}
                          testID="team-open-settings"
                        />
                      ) : null}
                      {canInviteMembers(team.role) ? (
                        <Button
                          ref={inviteTriggerRef}
                          label="action.invitePeople"
                          variant="secondary"
                          fullWidth={false}
                          onPress={handleOpenInvite}
                          testID="team-open-invite"
                        />
                      ) : null}
                    </View>
                  </Card>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
      {message !== undefined ? (
        <Card variant="flat" testID="teams-list-message">
          <Text variant="body-medium">{t(message)}</Text>
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
      {shouldShowDeletedTeamsTrigger(deletedTeams) ? (
        <Button
          ref={deletedTriggerRef}
          label="teams.deleted.button"
          labelParams={{ count: deletedTeams?.length ?? 0 }}
          variant="ghost"
          fullWidth={false}
          onPress={() => setDeletedModalOpen(true)}
          testID="deleted-teams-trigger"
        />
      ) : null}
      {devToolsVisible(__DEV__) ? (
        <Button label="gallery.title" icon="widgets" variant="secondary" onPress={openGallery} />
      ) : null}
      {toastMessage !== null ? <LiveRegion>{toastMessage}</LiveRegion> : null}
      <CreateTeamModal
        visible={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        returnFocusRef={createTriggerRef}
      />
      <DeletedTeamsModal
        visible={deletedModalOpen}
        teams={deletedTeams ?? []}
        isLoading={deletedTeamsQuery.isLoading}
        isError={deletedTeamsQuery.isError}
        restoreBusyId={restoreBusyId}
        onRetry={() => void deletedTeamsQuery.refetch()}
        onRestore={handleRestore}
        onClose={handleCloseDeletedModal}
        returnFocusRef={deletedTriggerRef}
        testID="deleted-teams-modal"
      />
    </TeamScreenLayout>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: MIN_TOUCH_TARGET,
  },
  headerBlock: { gap: Number(spacing.extraSmall) },
  list: { gap: Number(spacing.base) },
  teamBlock: { gap: Number(spacing.small) },
  teamRow: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: RING,
    borderRadius: shape.medium,
    paddingHorizontal: Number(spacing.small),
    paddingVertical: Number(spacing.small),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Number(spacing.base),
  },
  teamRowText: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Number(spacing.small),
    flexShrink: 1,
    flex: 1,
  },
  teamName: { flexShrink: 1 },
  teamRowCue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Number(spacing.extraSmall),
  },
  switchPill: {
    backgroundColor: colors['color-secondary-container'],
    borderRadius: shape.medium,
    paddingHorizontal: Number(spacing.extraSmall),
    paddingVertical: Number(spacing.extraSmall),
  },
  panelActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Number(spacing.small) },
});
