// DeleteAccountModal — modal flow for account deletion (Task D2; rules U1, U7, X1, X14; ADR 0018).
// Step 1: Warning + consequence breakdown from GET /account/delete-preview.
//         If Admin of active teams with other members, deletion is BLOCKED (409) and user is directed to Team settings.
// Step 2: Password verification + typing DELETE to confirm.
// On success: local signOut() and switch to signIn with notice.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Button } from './Button';
import { Input } from './Input';
import { LiveRegion } from './LiveRegion';
import { SheetModal } from './SheetModal';
import { Skeleton } from './Skeleton';
import { Text } from './Text';
import { t, type MessageKey } from '../i18n/en';
import { ApiError, accountApi, errorMessageKey } from '../lib/api';
import { useAuthSession } from '../state/auth-session';
import { useAuthViewStore } from '../state/auth-view';
import { useTeamsView } from '../state/teams-view';
import { spacing } from '../theme/tokens';
import { canProceedToStep2, isDeleteConfirmationReady } from '../lib/delete-account-logic';

export { canProceedToStep2, isDeleteConfirmationReady };

export type DeleteAccountModalProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly testID?: string;
};

export function DeleteAccountModal({
  visible,
  onClose,
  testID = 'delete-account-modal',
}: DeleteAccountModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  const signOut = useAuthSession((state) => state.signOut);
  const teamsViewGo = useTeamsView((state) => state.go);

  const previewQuery = useQuery({
    queryKey: ['account', 'delete-preview'],
    queryFn: () => accountApi.deletePreview(),
    enabled: visible,
    staleTime: 0,
  });

  const handleClose = () => {
    setStep(1);
    setPassword('');
    setConfirmText('');
    setError(null);
    onClose();
  };

  const preview = previewQuery.data;
  const isBlocked = preview ? !canProceedToStep2(preview.adminTeamsWithOthers.length) : false;
  const ready = isDeleteConfirmationReady(password, confirmText);

  const handleDelete = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await accountApi.deleteAccount({ password });
      handleClose();
      await signOut();
      useAuthViewStore.getState().switchTo('signIn', 'auth.notice.accountDeleted');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(errorMessageKey(err.code));
      } else {
        setError('generic.error');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetModal
      visible={visible}
      onClose={handleClose}
      headingKey="account.delete.heading"
      testID={testID}
    >
      <View style={styles.content}>
        {previewQuery.isLoading ? (
          <View style={styles.loadingContainer}>
            <Skeleton variant="block" />
            <Skeleton variant="text" />
          </View>
        ) : previewQuery.isError ? (
          <Text variant="body-medium" tone="error">
            {t('generic.error')}
          </Text>
        ) : step === 1 && preview ? (
          <View style={styles.stepContainer}>
            <Text variant="body-medium">
              {t('account.delete.warning')}
            </Text>

            {preview.hasActiveSubscription ? (
              <Text variant="body-medium" tone="error">
                {t('account.delete.subWarning')}
              </Text>
            ) : null}

            {preview.soleMemberTeams > 0 ? (
              <Text variant="body-medium" tone="secondary">
                {t('account.delete.soleTeams', { count: preview.soleMemberTeams })}
              </Text>
            ) : null}

            {preview.paysForTeams > 0 ? (
              <Text variant="body-medium" tone="secondary">
                {t('account.delete.paysTeams', { count: preview.paysForTeams })}
              </Text>
            ) : null}

            {isBlocked ? (
              <View style={styles.blockedBox}>
                <Text variant="body-medium" tone="error">
                  {t('account.delete.blocked')}
                </Text>
                <View style={styles.blockedList}>
                  {preview.adminTeamsWithOthers.map((team) => (
                    <Text key={team.id} variant="body-medium">
                      • {t('account.delete.blockedTeam', { name: team.name, count: team.otherMembers })}
                    </Text>
                  ))}
                </View>
                <Button
                  label="account.delete.openSettings"
                  variant="secondary"
                  onPress={() => {
                    handleClose();
                    teamsViewGo('teamSettings');
                  }}
                  testID="delete-account-open-settings"
                />
              </View>
            ) : null}

            <View style={styles.actions}>
              {!isBlocked ? (
                <Button
                  label="action.next"
                  variant="danger"
                  onPress={() => setStep(2)}
                  testID="delete-account-next"
                />
              ) : null}
              <Button
                label="action.cancel"
                variant="ghost"
                onPress={handleClose}
                testID="delete-account-cancel"
              />
            </View>
          </View>
        ) : (
          <View style={styles.stepContainer}>
            <Text variant="body-medium">
              {t('account.delete.step2Text')}
            </Text>

            <Input
              label="field.password"
              variant="password"
              value={password}
              onChangeText={setPassword}
              testID="delete-account-password"
            />

            <Input
              label="account.delete.typeDelete"
              variant="text"
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="characters"
              testID="delete-account-confirm-text"
            />

            {error !== null ? <LiveRegion tone="error">{error}</LiveRegion> : null}

            <View style={styles.actions}>
              <Button
                label="account.delete.confirmButton"
                variant="danger"
                ready={ready}
                reason="account.delete.mismatch"
                busy={busy}
                onPress={() => void handleDelete()}
                testID="delete-account-submit"
              />
              <Button
                label="action.back"
                variant="ghost"
                onPress={() => setStep(1)}
                testID="delete-account-back"
              />
            </View>
          </View>
        )}
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Number(spacing.base),
  },
  loadingContainer: {
    gap: Number(spacing.base),
  },
  stepContainer: {
    gap: Number(spacing.base),
  },
  blockedBox: {
    gap: Number(spacing.small),
  },
  blockedList: {
    paddingLeft: Number(spacing.small),
    gap: Number(spacing.extraSmall),
  },
  actions: {
    gap: Number(spacing.small),
    marginTop: Number(spacing.small),
  },
});

