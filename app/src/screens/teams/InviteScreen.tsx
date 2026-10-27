// InviteScreen — invite a person and manage pending invitations (rules V1, V5, U5, U7, X3, S5;
// PRD 8.2). The form's role OPTIONS come from inviteRoleOptions(team.role) — the SERVER's view of
// the viewer's role (Manager sees Staff ONLY; Owner sees Manager + Staff; the Owner role is never
// invitable). The server enforces the same rule; this is the UI mirror, never the authority (S5).
// The pending list offers Revoke where the revoke rules allow (Owner any open invite; Manager only
// when the team's managersCanRevokeInvites setting is on) — again a UI mirror of the server rule.
// "Invitation sent." is ALWAYS shown on success (catalog, U8); seat-cap and other failures map
// through errorMessageKey (V5, team.seatLimit).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInstance, type TextInputInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { inviteMemberSchema, type TeamRole } from '@rowta/shared';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Input, LiveRegion, Skeleton, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { ApiError, errorTextKey, fieldErrorKey, teamsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { inviteRoleOptions, useTeam, useTeamInvites, useTeams } from '../../state/teams';
import { useTeamsView } from '../../state/teams-view';
import { colors, spacing } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../../theme/layout';

const ROLE_LABEL: Record<string, MessageKey> = { owner: 'role.owner', manager: 'role.manager', staff: 'role.staff' };
const ROLE_TONE: Record<string, 'primary' | 'neutral'> = { owner: 'primary', manager: 'neutral', staff: 'neutral' };

export function InviteScreen() {
  const emailRef = useRef<TextInputInstance>(null);
  const headingRef = useRef<TextInstance>(null);
  const queryClient = useQueryClient();
  const back = useTeamsView((state) => state.back);
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const teamQuery = useTeam(selectedTeamId);
  const invitesQuery = useTeamInvites(selectedTeamId);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('staff');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [emailFieldError, setEmailFieldError] = useState<MessageKey | null>(null);
  const [announcement, setAnnouncement] = useState<MessageKey | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const team = teamQuery.data;
  const invites = invitesQuery.data?.invites;
  const options = inviteRoleOptions(team?.role ?? 'staff');
  const canRevokeOne = (inviteRole: TeamRole): boolean => {
    if (team?.role === 'owner') return true;
    if (team?.role === 'manager') return team.managersCanRevokeInvites && inviteRole !== 'owner';
    return false;
  };

  useEffect(() => {
    focusOn(emailRef.current);
  }, []);

  useEffect(() => {
    const first = options[0];
    if (first !== undefined && !options.includes(role)) setRole(first);
  }, [options, role]);

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['teams'] });
  };

  const onInvite = async (): Promise<void> => {
    const parsed = inviteMemberSchema.safeParse({ email: email.trim(), role });
    if (!parsed.success) {
      const issues = parsed.error.flatten().fieldErrors;
      const first = issues.email?.[0];
      const key: MessageKey = first !== undefined ? fieldErrorKey(first) : 'auth.email.invalid';
      setEmailFieldError(key);
      setErrorKey(null);
      setAnnouncement(key);
      focusOn(emailRef.current);
      return;
    }
    if (selectedTeamId === null) return;
    setEmailFieldError(null);
    setErrorKey(null);
    setBusy(true);
    setAnnouncement(null);
    try {
      await teamsApi.createInvite(selectedTeamId, parsed.data);
      await invalidate();
      setAnnouncement('team.invite.sent');
      setEmail('');
    } catch (error) {
      if (error instanceof ApiError) {
        setEmailFieldError(error.fields?.email !== undefined ? fieldErrorKey(error.fields.email) : null);
        const key = errorTextKey(error);
        setErrorKey(error.fields?.email !== undefined ? null : key);
        setAnnouncement(key);
      } else {
        setErrorKey('generic.error');
        setAnnouncement('generic.error');
      }
      focusOn(emailRef.current);
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = (): void => {
    if (revokeId === null || selectedTeamId === null) return;
    const id = revokeId;
    setBusy(true);
    void teamsApi
      .revokeInvite(selectedTeamId, id)
      .then(async () => {
        await invalidate();
        setAnnouncement('teams.toast.inviteRevoked');
      })
      .catch((error: unknown) => {
        setAnnouncement(error instanceof ApiError ? errorTextKey(error) : 'generic.error');
      })
      .finally(() => {
        setBusy(false);
        setRevokeId(null);
      });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.content}>
          <Text ref={headingRef} variant="headline-small" accessibilityRole="header">
            {t('teams.view.invite.heading')}
          </Text>
          <Input
            ref={emailRef}
            label="field.email"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              setEmailFieldError(null);
              setErrorKey(null);
            }}
            variant="email"
            errorKey={emailFieldError ?? undefined}
            testID="invite-email"
          />
          <View style={styles.roleRow}>
            <Text variant="body-medium">{t('field.role')}</Text>
            {options.map((option) => (
              <Button
                key={option}
                label={ROLE_LABEL[option] ?? 'role.staff'}
                variant={role === option ? 'primary' : 'ghost'}
                fullWidth={false}
                onPress={() => setRole(option)}
                testID={`invite-role-${option}`}
              />
            ))}
          </View>
          {errorKey !== null ? (
            <LiveRegion tone="error">{errorKey}</LiveRegion>
          ) : null}
          <Button label="action.sendInvite" busy={busy} onPress={() => void onInvite()} testID="invite-submit" />
          <Text variant="title-medium" accessibilityRole="header">
            {t('action.pendingInvites')}
          </Text>
          {invitesQuery.isLoading ? (
            <Skeleton variant="text" />
          ) : invitesQuery.isError ? (
            <EmptyState kind="error" action={{ label: 'action.retry', onPress: () => void invitesQuery.refetch() }} />
          ) : invites !== undefined && invites.length === 0 ? (
            <EmptyState kind="empty" titleKey="teams.invites.empty.title" bodyKey="teams.invites.empty.body" />
          ) : (
            <View style={styles.list}>
              {invites?.map((invite) => (
                <Card key={invite.id} variant="flat" testID={`invite-${invite.id}`}>
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <Text variant="title-medium">{invite.email}</Text>
                      <Badge label={ROLE_LABEL[invite.role] ?? 'role.staff'} tone={ROLE_TONE[invite.role] ?? 'neutral'} />
                    </View>
                    {canRevokeOne(invite.role) ? (
                      <Button
                        label="action.revoke"
                        variant="danger"
                        fullWidth={false}
                        onPress={() => setRevokeId(invite.id)}
                        testID={`invite-revoke-${invite.id}`}
                      />
                    ) : null}
                  </View>
                </Card>
              ))}
            </View>
          )}
          <Button label="action.back" variant="ghost" onPress={back} />
          {announcement !== null && announcement !== errorKey ? (
            <LiveRegion>{announcement}</LiveRegion>
          ) : null}
        </View>
      </View>
      <ConfirmDialog
        visible={revokeId !== null}
        titleKey="teams.confirm.revoke.title"
        messageKey="teams.confirm.revoke.message"
        confirmLabel="action.revoke"
        destructive
        busy={busy}
        onConfirm={onRevoke}
        onCancel={() => setRevokeId(null)}
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
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: Number(spacing.small), flexWrap: 'wrap' },
});
