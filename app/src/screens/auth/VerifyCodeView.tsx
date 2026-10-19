// VerifyCodeView — PRD 6.1 step "verify code" inside the AuthPage card (heading rendered by the page).
// X14: ready at exactly six digits with the reason auth.ready.code; not-ready keeps the button focusable and
// moves focus back to the code field. The expiry line is static catalog text (PRD 11 auth.code.expiresIn).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { Button, Input, Text } from '../../components';
import { t } from '../../i18n/en';
import { focusOn } from '../../lib/a11y';
import { useSessionStore } from '../../state/session';
import { spacing } from '../../theme/tokens';

export function VerifyCodeView() {
  const codeRef = useRef<TextInputInstance>(null);
  const [code, setCode] = useState('');
  const ready = /^\d{6}$/.test(code);

  useEffect(() => {
    focusOn(codeRef.current);
  }, []);

  return (
    <View style={styles.stack}>
      <Text variant="body-small" tone="secondary">
        {t('auth.code.expiresIn')}
      </Text>
      <Input ref={codeRef} label="field.code" variant="code" value={code} onChangeText={setCode} maxLength={6} />
      <Button
        label="action.verify"
        ready={ready}
        reason="auth.ready.code"
        onNotReady={() => {
          focusOn(codeRef.current);
        }}
        onPress={() => {
          useSessionStore.getState().signIn();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
});
