// ResetCodeView — PRD 6.1 step "reset code" inside the AuthPage card (heading rendered by the page).
// X14: ready at exactly six digits with reason auth.ready.code; focus returns to the code field when not ready.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { Button, Input } from '../../components';
import { focusOn } from '../../lib/a11y';
import { useAuthViewStore } from '../../state/auth-view';
import { spacing } from '../../theme/tokens';

export function ResetCodeView() {
  const go = useAuthViewStore((state) => state.go);
  const codeRef = useRef<TextInputInstance>(null);
  const [code, setCode] = useState('');
  const ready = /^\d{6}$/.test(code);

  useEffect(() => {
    focusOn(codeRef.current);
  }, []);

  return (
    <View style={styles.stack}>
      <Input ref={codeRef} label="field.code" variant="code" value={code} onChangeText={setCode} maxLength={6} />
      <Button
        label="action.verify"
        ready={ready}
        reason="auth.ready.code"
        onNotReady={() => {
          focusOn(codeRef.current);
        }}
        onPress={() => {
          go('resetPassword');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
});
