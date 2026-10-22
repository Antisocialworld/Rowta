// ResetNewPasswordView — PRD 6.1 step "new password" inside the AuthPage card (Phase 2: real API).
// The server hashes with Argon2id (A1). PRD 8.1: the polite LiveRegion announces "Use at least 8
// characters." while the user types (X3), at the ONE shared PASSWORD_MIN_LENGTH (V1). X14/V6:
// readiness IS the shared resetNewPasswordSchema (V1) — password at the shared minimum plus an
// identical confirmation, grant from the flow context — reason auth.ready.resetNew.
// Phase 2: submit carries the 10-minute GRANT from the flow context (A10) to POST /auth/reset; the
// grant is single-use and is dropped with the rest of the code flow on success. Success SWITCHES to
// signIn carrying auth.reset.done (PRD 11). A missing grant (a stray landing on this view) fails as
// generic.error without any request — the token never appears on screen (A10, V5).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { PASSWORD_MIN_LENGTH } from '@rowta/shared';
import { Button, Input, LiveRegion, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { focusOn } from '../../lib/a11y';
import { authApi } from '../../lib/api';
import { resetNewPasswordReady } from '../../lib/validation';
import { useAuthFlow } from '../../state/auth-context';
import { useAuthForm } from '../../state/auth-form';
import { useAuthViewStore } from '../../state/auth-view';
import { spacing } from '../../theme/tokens';

export function ResetNewPasswordView() {
  const switchTo = useAuthViewStore((state) => state.switchTo);
  const grant = useAuthFlow((state) => state.grant);
  const clearCodeFlow = useAuthFlow((state) => state.clearCodeFlow);
  const form = useAuthForm();
  const firstRef = useRef<TextInputInstance>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const ready = resetNewPasswordReady(grant, password, confirm);
  // TS 6.0 quirk: a string-literal union in a JSX children position is rejected as a single child; a typed
  // variable of the same MessageKey type is accepted (AuthPage does the same with the machine's message).
  const tooShortKey: MessageKey = 'auth.password.tooShort';

  useEffect(() => {
    focusOn(firstRef.current);
  }, []);

  const submitReset = async (): Promise<void> => {
    if (grant === null) {
      // No grant in context: refuse locally, request nothing, surface only a catalog key (A10, V5).
      const failed = await form.submit(() => Promise.reject(new Error('missing grant')));
      if (failed === null) focusOn(firstRef.current);
      return;
    }
    const result = await form.submit(() => authApi.resetNewPassword({ grant, newPassword: password, confirm }));
    if (result === null) {
      focusOn(firstRef.current);
      return;
    }
    clearCodeFlow();
    switchTo('signIn', 'auth.reset.done');
  };

  return (
    <View style={styles.stack}>
      <Input
        ref={firstRef}
        label="field.newPassword"
        variant="newPassword"
        value={password}
        onChangeText={setPassword}
        errorKey={form.fieldError('newPassword')}
      />
      <Input
        label="field.confirmPassword"
        variant="newPassword"
        value={confirm}
        onChangeText={setConfirm}
        errorKey={confirm.length > 0 && confirm !== password ? 'auth.password.mismatch' : form.fieldError('confirm')}
      />
      {password.length > 0 && password.length < PASSWORD_MIN_LENGTH ? (
        <LiveRegion>{tooShortKey}</LiveRegion>
      ) : null}
      <Button
        label="action.resetPassword"
        ready={ready}
        reason="auth.ready.resetNew"
        busy={form.busy}
        onNotReady={() => {
          focusOn(firstRef.current);
        }}
        onPress={() => {
          void submitReset();
        }}
      />
      {form.formError !== null ? <LiveRegion>{form.formError}</LiveRegion> : null}
      {form.retryIn !== null && form.retryIn > 0 ? (
        <Text variant="body-small" tone="secondary">
          {t('auth.rateLimit.retryIn', { seconds: form.retryIn })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
});
