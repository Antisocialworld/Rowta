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
import { Button, Input, LiveRegion, PasswordRulesChecklist, Text } from '../../components';
import { focusOn } from '../../lib/a11y';
import { authApi } from '../../lib/api';
import { formatRetryIn } from '../../lib/countdown';
import { resetNewPasswordReady } from '../../lib/validation';
import { useAuthFlow } from '../../state/auth-context';
import { createSubmitTrigger, useAuthForm } from '../../state/auth-form';
import { useAuthViewStore } from '../../state/auth-view';
import { spacing } from '../../theme/tokens';

export function ResetNewPasswordView() {
  const switchTo = useAuthViewStore((state) => state.switchTo);
  const grant = useAuthFlow((state) => state.grant);
  const clearCodeFlow = useAuthFlow((state) => state.clearCodeFlow);
  const form = useAuthForm();
  const firstRef = useRef<TextInputInstance>(null);
  const confirmRef = useRef<TextInputInstance>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const ready = resetNewPasswordReady(grant, password, confirm);

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

  const handleSubmit = createSubmitTrigger({
    ready,
    busy: form.busy,
    onNotReady: () => {
      focusOn(firstRef.current);
    },
    submit: submitReset,
  });

  return (
    <View style={styles.stack}>
      <Input
        ref={firstRef}
        label="field.newPassword"
        variant="newPassword"
        value={password}
        onChangeText={setPassword}
        errorKey={form.fieldError('newPassword')}
        returnKeyType="next"
        onSubmitEditing={() => {
          focusOn(confirmRef.current);
        }}
      />
      <Input
        ref={confirmRef}
        label="field.confirmPassword"
        variant="newPassword"
        value={confirm}
        onChangeText={setConfirm}
        errorKey={confirm.length > 0 && confirm !== password ? 'auth.password.mismatch' : form.fieldError('confirm')}
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
      />
      <PasswordRulesChecklist password={password} testID="reset-password-checklist" />
      <Button
        label="action.resetPassword"
        ready={ready}
        reason="auth.ready.resetNew"
        busy={form.busy}
        onNotReady={() => {
          focusOn(firstRef.current);
        }}
        onPress={handleSubmit}
      />
      {form.formError !== null ? <LiveRegion>{form.formError}</LiveRegion> : null}
      {form.retryIn !== null && form.retryIn > 0 ? (
        <Text variant="body-small" tone="secondary">
          {formatRetryIn(form.retryIn)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
});
