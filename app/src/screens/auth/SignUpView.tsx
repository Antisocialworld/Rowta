// SignUpView — the CREATE ACCOUNT form of the one AuthPage card (PRD 6.1 "sign up"; Phase 2: real API).
// X14: ready only when every field is filled, the password meets the 8-character minimum and the
// confirmation matches; not-ready keeps the button focusable with auth.ready.signUp announced.
// Country (PRD 8.1, S5): the SERVER owns the list — GET /auth/countries through TanStack Query —
// rendered in a BottomSheet of button rows (no free text, no client-side country list). The field is
// a labelled button whose accessible name carries the chosen country; choosing restores focus to it
// (X4). Before the list arrives the field opens to loading / the failure line with a retry; a locale
// heuristic pre-selects a match from the SERVER's rows only (never an invented code).
// Submit: POST /auth/signup with the shared schema (V1); the uniform message + server code timers
// carry to verifyCode (A9, PRD 11).
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type PressableInstance, type TextInputInstance } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { MaterialIcons } from '@expo/vector-icons';
import { BottomSheet, Button, Input, LinkButton, LiveRegion, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { focusOn } from '../../lib/a11y';
import { authApi } from '../../lib/api';
import { isEmailLike, PASSWORD_MIN } from '../../lib/validation';
import { colors, shape, spacing } from '../../theme/tokens';
import { MIN_TOUCH_TARGET, RING, iconSize } from '../../theme/layout';
import { useAuthFlow } from '../../state/auth-context';
import { useAuthForm } from '../../state/auth-form';
import { useAuthViewStore } from '../../state/auth-view';

export function SignUpView() {
  const switchTo = useAuthViewStore((state) => state.switchTo);
  const go = useAuthViewStore((state) => state.go);
  const setFlow = useAuthFlow((state) => state.setFlow);
  const form = useAuthForm();
  const nameRef = useRef<TextInputInstance>(null);
  const countryRef = useRef<PressableInstance>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const ready =
    name.trim().length > 0 &&
    isEmailLike(email) &&
    country.trim().length > 0 &&
    password.length >= PASSWORD_MIN &&
    confirm === password;

  const countries = useQuery({ queryKey: ['auth', 'countries'], queryFn: authApi.countries });
  const countryName = countries.data?.find((item) => item.code === country)?.name ?? null;

  // Locale heuristic: pre-select a row the SERVER returned; nothing is invented client-side.
  useEffect(() => {
    if (country !== '' || countries.data === undefined) return;
    const region = Intl.DateTimeFormat()
      .resolvedOptions()
      .locale.split('-')
      .pop();
    if (region === undefined) return;
    const match = countries.data.find((item) => item.code === region.toUpperCase());
    if (match !== undefined) setCountry(match.code);
  }, [countries.data, country]);

  useEffect(() => {
    focusOn(nameRef.current);
  }, []);

  const closeSheet = (): void => {
    setSheetOpen(false);
    focusOn(countryRef.current);
  };

  const submitSignUp = async (): Promise<void> => {
    const result = await form.submit(() =>
      authApi.signUp({ displayName: name, email, country, password, confirm }),
    );
    if (result === null) {
      focusOn(nameRef.current);
      return;
    }
    setFlow({ email, codeMeta: result.meta });
    go('verifyCode', 'auth.signUp.submitted');
  };

  const countryError = form.fieldError('country');
  const countryErrorText = countryError !== undefined ? t(countryError) : null;
  // TS 6.0 quirk (see ResetNewPasswordView): a string-literal union as a single JSX child is rejected;
  // a typed MessageKey variable of the same value is accepted.
  const countriesUnavailableKey: MessageKey = 'auth.countries.unavailable';

  return (
    <View style={styles.stack}>
      <Input
        ref={nameRef}
        label="field.name"
        variant="name"
        value={name}
        onChangeText={setName}
        maxLength={60}
        errorKey={form.fieldError('displayName')}
      />
      <Input label="field.email" variant="email" value={email} onChangeText={setEmail} errorKey={form.fieldError('email')} />
      <View style={styles.countryBlock}>
        <Text variant="label-medium" tone="secondary" style={styles.countryLabel}>
          {t('field.country')}
        </Text>
        <Pressable
          ref={countryRef}
          onPress={() => setSheetOpen(true)}
          accessible
          accessibilityRole="button"
          accessibilityLabel={countryName === null ? t('field.country') : `${t('field.country')}: ${countryName}`}
          style={[
            styles.countryField,
            {
              backgroundColor: colors['color-surface-container-high'],
              borderColor: countryError !== undefined ? colors['color-error'] : colors['color-surface-container-high'],
            },
          ]}
          testID="field-country"
        >
          <Text variant="body-large" style={countryName === null ? styles.countryPlaceholderText : undefined}>
            {countryName ?? ''}
          </Text>
          <MaterialIcons
            name="expand-more"
            size={iconSize('title-medium')}
            color={colors['color-on-surface-variant']}
            accessibilityElementsHidden
          />
        </Pressable>
        {countryErrorText !== null ? (
          <Text variant="body-small" tone="error" style={styles.countryMessage} accessibilityLiveRegion="polite">
            {countryErrorText}
          </Text>
        ) : null}
      </View>
      <Input
        label="field.password"
        variant="newPassword"
        value={password}
        onChangeText={setPassword}
        errorKey={form.fieldError('password')}
      />
      <Input
        label="field.confirmPassword"
        variant="newPassword"
        value={confirm}
        onChangeText={setConfirm}
        errorKey={confirm.length > 0 && confirm !== password ? 'auth.password.mismatch' : form.fieldError('confirm')}
      />
      <Button
        label="action.createAccount"
        ready={ready}
        reason="auth.ready.signUp"
        busy={form.busy}
        onNotReady={() => {
          focusOn(nameRef.current);
        }}
        onPress={() => {
          void submitSignUp();
        }}
      />
      {form.formError !== null ? <LiveRegion>{form.formError}</LiveRegion> : null}
      <LinkButton label="action.backToSignIn" onPress={() => switchTo('signIn')} testID="link-back-to-signin" />

      <BottomSheet visible={sheetOpen} onClose={closeSheet} titleKey="field.country" testID="sheet-country">
        {countries.isPending ? (
          <Text variant="body-medium" tone="secondary">
            {t('generic.loading')}
          </Text>
        ) : countries.isError ? (
          <View style={styles.sheetMessage}>
            <LiveRegion tone="error">{countriesUnavailableKey}</LiveRegion>
            <Button
              label="action.retry"
              variant="secondary"
              onPress={() => {
                void countries.refetch();
              }}
              testID="countries-retry"
            />
          </View>
        ) : countries.data.length === 0 ? (
          <Text variant="body-medium" tone="secondary">
            {t('generic.empty.body')}
          </Text>
        ) : (
          <View testID="countries-list">
            {countries.data.map((item) => (
              <Pressable
                key={item.code}
                onPress={() => {
                  setCountry(item.code);
                  closeSheet();
                }}
                accessible
                accessibilityRole="button"
                accessibilityLabel={item.name}
                style={styles.countryRow}
                testID={`country-row-${item.code}`}
              >
                <Text variant="body-large" style={styles.countryRowText}>
                  {item.name}
                </Text>
                {item.code === country ? (
                  <MaterialIcons
                    name="check"
                    size={iconSize('title-medium')}
                    color={colors['color-primary']}
                    accessibilityElementsHidden
                  />
                ) : null}
              </Pressable>
            ))}
          </View>
        )}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
  countryBlock: { gap: spacing.extraSmall },
  countryLabel: { marginLeft: spacing.extraSmall },
  countryField: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.medium,
    paddingVertical: spacing.small,
    borderRadius: shape.small,
    borderWidth: RING,
  },
  countryPlaceholderText: { color: colors['color-on-surface-variant'] },
  countryMessage: { marginLeft: spacing.extraSmall },
  sheetMessage: { gap: spacing.base, alignItems: 'flex-start' },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.small,
    paddingHorizontal: spacing.extraSmall,
    gap: spacing.small,
  },
  countryRowText: { flex: 1 },
});
