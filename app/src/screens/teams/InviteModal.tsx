// InviteModal — Phase 3 invite form modal (rules V1, V5, U1, U5, U7, U8, X3, X14; PRD 6.1, 8.2; Stage M3).
// Built on SheetModal: inherits centering padding, maxHeight 85%, ScrollView, and pinned footer.
// Role options come from inviteRoleOptions(team.role) — the server's view of the viewer's role
// (Manager sees Staff ONLY; Owner sees Manager + Staff; Owner role is never invitable).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { inviteMemberSchema, type TeamRole } from '@rowta/shared';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { LiveRegion } from '../../components/LiveRegion';
import { SheetModal } from '../../components/SheetModal';
import { Text } from '../../components/Text';
import { t, type MessageKey } from '../../i18n/en';
import { ApiError, errorTextKey, fieldErrorKey, teamsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { inviteRoleOptions, useTeam, useTeams } from '../../state/teams';
import { useInviteModal } from '../../state/invite-modal';
import { spacing } from '../../theme/tokens';

const ROLE_LABEL: Record<string, MessageKey> = {
  owner: 'role.owner',
  manager: 'role.manager',
  staff: 'role.staff',
};

export type InviteModalProps = {
  readonly visible?: boolean;
  readonly onClose?: () => void;
  readonly returnFocusRef?: { current: unknown } | null;
  readonly testID?: string;
};

export function InviteModal(props: InviteModalProps) {
  const storeVisible = useInviteModal((state) => state.visible);
  const storeClose = useInviteModal((state) => state.close);
  const storeReturnFocusRef = useInviteModal((state) => state.returnFocusRef);

  const visible = props.visible ?? storeVisible;
  const onClose = props.onClose ?? storeClose;
  const returnFocusRef = props.returnFocusRef ?? storeReturnFocusRef;
  const testID = props.testID ?? 'invite-modal';

  const emailRef = useRef<TextInputInstance>(null);
  const queryClient = useQueryClient();
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const teamQuery = useTeam(selectedTeamId);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('staff');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [emailFieldError, setEmailFieldError] = useState<MessageKey | null>(null);
  const [announcement, setAnnouncement] = useState<MessageKey | null>(null);

  const team = teamQuery.data;
  const options = inviteRoleOptions(team?.role ?? 'staff');

  useEffect(() => {
    if (visible) {
      focusOn(emailRef.current);
    }
  }, [visible]);

  useEffect(() => {
    const first = options[0];
    if (first !== undefined && !options.includes(role)) {
      setRole(first);
    }
  }, [options, role]);

  const handleClose = () => {
    setEmail('');
    setErrorKey(null);
    setEmailFieldError(null);
    setAnnouncement(null);
    onClose();
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
      await queryClient.invalidateQueries({ queryKey: ['teams'] });
      setAnnouncement('team.invite.sent');
      handleClose();
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

  const footer = (
    <View style={styles.footerRow}>
      <Button
        label="action.cancel"
        variant="ghost"
        fullWidth={false}
        onPress={handleClose}
        testID="invite-cancel"
      />
      <Button
        label="action.sendInvite"
        variant="primary"
        fullWidth={false}
        busy={busy}
        ready={email.trim().length > 0}
        reason="auth.email.invalid"
        onPress={() => void onInvite()}
        testID="invite-submit"
      />
    </View>
  );

  return (
    <SheetModal
      visible={visible}
      onClose={handleClose}
      headingKey="teams.view.invite.heading"
      returnFocusRef={returnFocusRef}
      testID={testID}
      cardTestID="invite-section"
      headingTestID="invite-heading"
      footer={footer}
    >
      <View style={styles.body}>
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

        <View style={styles.roleBlock}>
          <Text variant="body-medium">{t('field.role')}</Text>
          <View style={styles.roleRow}>
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
        </View>

        {errorKey !== null ? (
          <LiveRegion tone="error">{errorKey}</LiveRegion>
        ) : null}
        {announcement !== null && announcement !== errorKey ? (
          <LiveRegion>{announcement}</LiveRegion>
        ) : null}
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Number(spacing.base),
  },
  roleBlock: {
    gap: Number(spacing.small),
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Number(spacing.small),
    flexWrap: 'wrap',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Number(spacing.small),
  },
});

