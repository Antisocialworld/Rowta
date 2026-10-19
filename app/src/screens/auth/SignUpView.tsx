// SignUpView — the CREATE ACCOUNT form of the one AuthPage card (PRD 6.1 "sign up"; rework item 1: conditional
// rendering inside ONE card; the heading under the logo is rendered by AuthPage, not here).
// X14: ready only when every field is filled, the password meets the 8-character minimum and the confirmation
// matches; not-ready keeps the button focusable with auth.ready.signUp announced. A successful submit carries
// the uniform message auth.signUp.submitted to verifyCode (PRD 11; AuthPage's LiveRegion).
// Secondary action is the text link "Back to sign in" (item 3); hardware Back does the same (item 7).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { Button, Input, LinkButton } from '../../components';
import { focusOn } from '../../lib/a11y';
import { isEmailLike, PASSWORD_MIN } from '../../lib/validation';
import { useAuthViewStore } from '../../state/auth-view';
import { spacing } from '../../theme/tokens';

export function SignUpView() {
  const switchTo = useAuthViewStore((state) => state.switchTo);
  const go = useAuthViewStore((state) => state.go);
  const nameRef = useRef<TextInputInstance>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const ready =
    name.trim().length > 0 &&
    isEmailLike(email) &&
    country.trim().length > 0 &&
    password.length >= PASSWORD_MIN &&
    confirm === password;

  useEffect(() => {
    focusOn(nameRef.current);
  }, []);

  return (
    <View style={styles.stack}>
      <Input ref={nameRef} label="field.name" variant="name" value={name} onChangeText={setName} />
      <Input label="field.email" variant="email" value={email} onChangeText={setEmail} />
      <Input label="field.country" variant="text" value={country} onChangeText={setCountry} />
      <Input label="field.password" variant="newPassword" value={password} onChangeText={setPassword} />
      <Input
        label="field.confirmPassword"
        variant="newPassword"
        value={confirm}
        onChangeText={setConfirm}
        errorKey={confirm.length > 0 && confirm !== password ? 'auth.password.mismatch' : undefined}
      />
      <Button
        label="action.createAccount"
        ready={ready}
        reason="auth.ready.signUp"
        onNotReady={() => {
          focusOn(nameRef.current);
        }}
        onPress={() => {
          go('verifyCode', 'auth.signUp.submitted');
        }}
      />
      <LinkButton label="action.backToSignIn" onPress={() => switchTo('signIn')} testID="link-back-to-signin" />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
});
