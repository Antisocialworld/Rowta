// Input — the labelled text field of every Rowta form (rules U5, U7, U8, X1, X2, X3, X5, X6, V1).
//
// Variants: text | email | password | newPassword | code | name — each preset carries the autofill and keyboard
//           behaviour, using the `autoComplete` values verified in the installed React Native types
//           ("email", "password", "new-password", "one-time-code", "name").
// States:   resting  filled surface-container-high field, hairline-free (colour does the separating).
//           focused  RING border in primary, laid out from first render (unfocused it matches the fill), so
//                    focus never shifts the layout; >= 3:1 against the fill (docs/a11y/contrast.md).
//           error    RING border in error + the message below in a POLITE live region (X3), and the error text is
//                    also the field's accessibilityHint, so it is part of the field's description (X2).
//           hidden   password variants mask the text; the show/hide control is an icon-only button named from the
//                    catalog (action.showPassword / action.hidePassword — X1, U8).
// Props:    label (catalog key, always visible — there is deliberately no placeholder, so no doubled or lost
//           instruction), value, onChangeText, errorKey, hintKey, variant, editable, maxLength, testID, and a ref
//           the view uses with focusOn() to satisfy U7 (auto focus, focus the first problem after a failed submit).
// Behaviour: never holds user words: everything readable comes from t() (U8). zod validation rules live in
//           /shared and run on submit — this component only shows what the view tells it (V1, S5).
import { forwardRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputInstance,
  type TextInputProps,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, shape, spacing } from '../theme/tokens';
import { typeStyle } from '../theme/fonts';
import { MIN_TOUCH_TARGET, RING, iconSize } from '../theme/layout';
import { hapticSelection } from '../lib/haptics';
import { t, type MessageKey } from '../i18n/en';
import { Text } from './Text';

export type InputVariant = 'text' | 'email' | 'password' | 'newPassword' | 'code' | 'name';

type Setup = {
  autoComplete?: TextInputProps['autoComplete'];
  keyboardType?: KeyboardTypeOptions;
  secure: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
};

/**
 * Maps React Native convenience autocomplete values to standard HTML tokens for web compatibility.
 * Specifically, 'password' is mapped to 'current-password' (HTML standard).
 */
export function mapAutoComplete(
  autoComplete?: TextInputProps['autoComplete'],
): TextInputProps['autoComplete'] {
  if (autoComplete === 'password') {
    return 'current-password';
  }
  return autoComplete;
}

const SETUP: Record<InputVariant, Setup> = {
  text: { secure: false },
  name: { secure: false, autoComplete: 'name', autoCapitalize: 'words' },
  email: { secure: false, autoComplete: 'email', keyboardType: 'email-address', autoCapitalize: 'none' },
  password: { secure: true, autoComplete: 'current-password', autoCapitalize: 'none' },
  newPassword: { secure: true, autoComplete: 'new-password', autoCapitalize: 'none' },
  code: { secure: false, autoComplete: 'one-time-code', keyboardType: 'number-pad' },
};

export type InputProps = {
  /** Catalog key for the visible label AND the field's accessible name. */
  label: MessageKey;
  value: string;
  onChangeText: (value: string) => void;
  variant?: InputVariant;
  /** Catalog key: shows the message under the field and becomes the accessibilityHint (X2). */
  errorKey?: MessageKey;
  /** Catalog key: quiet guidance shown when there is no error. */
  hintKey?: MessageKey;
  editable?: boolean;
  maxLength?: number;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
  secureTextEntry?: boolean;
  testID?: string;
  id?: string;
  name?: string;
  autoComplete?: TextInputProps['autoComplete'];
  /** Optional handler to clear the input text. Renders a clear button inside the field when value is non-empty. */
  onClear?: () => void;
  clearLabel?: MessageKey;
  clearTestID?: string;
};

export const Input = forwardRef<TextInputInstance, InputProps>(function Input(
  {
    label,
    value,
    onChangeText,
    variant = 'text',
    errorKey,
    hintKey,
    editable = true,
    maxLength,
    autoCapitalize,
    returnKeyType,
    onSubmitEditing,
    secureTextEntry,
    testID,
    id,
    name,
    autoComplete,
    onClear,
    clearLabel,
    clearTestID,
  },
  ref,
) {
  const setup = SETUP[variant];
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const secure = setup.secure === true && secureTextEntry !== false;
  const borderColor = errorKey !== undefined ? colors['color-error'] : focused ? colors['color-primary'] : undefined;

  // Stable id and name derived from explicit prop, testID, or catalog label key
  const inputName = name ?? testID ?? label;
  const inputId = id ?? testID ?? name ?? label;
  const effectiveAutoComplete = mapAutoComplete(autoComplete ?? setup.autoComplete);

  return (
    <View style={styles.root}>
      <Text variant="label-medium" tone="secondary" style={styles.label}>
        {t(label)}
      </Text>
      <View
        style={[
          styles.field,
          { backgroundColor: colors['color-surface-container-high'], borderColor: borderColor ?? colors['color-surface-container-high'] },
        ]}
      >
        <TextInput
          ref={ref}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          editable={editable}
          maxLength={maxLength}
          autoComplete={effectiveAutoComplete}
          keyboardType={setup.keyboardType}
          autoCapitalize={autoCapitalize ?? setup.autoCapitalize}
          autoCorrect={false}
          secureTextEntry={secure && hidden}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          testID={testID}
          id={inputId}
          name={inputName}
          nativeID={inputId}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={t(label)}
          accessibilityHint={errorKey !== undefined ? t(errorKey) : hintKey !== undefined ? t(hintKey) : undefined}
          accessibilityState={{ disabled: editable === false }}
        />
        {secure ? (
          <Pressable
            onPress={() => {
              setHidden((current) => !current);
              hapticSelection();
            }}
            accessible
            accessibilityRole="button"
            accessibilityLabel={t(hidden ? 'action.showPassword' : 'action.hidePassword')}
            style={styles.toggle}
            testID={testID !== undefined ? `${testID}-toggle` : undefined}
          >
            <MaterialIcons
              name={hidden ? 'visibility' : 'visibility-off'}
              size={iconSize('title-medium')}
              color={colors['color-on-surface-variant']}
              accessibilityElementsHidden
            />
          </Pressable>
        ) : null}
        {onClear !== undefined && value.length > 0 ? (
          <Pressable
            onPress={() => {
              onClear();
              hapticSelection();
            }}
            accessible
            accessibilityRole="button"
            accessibilityLabel={t(clearLabel ?? 'action.clearSearch')}
            style={styles.toggle}
            testID={clearTestID ?? (testID !== undefined ? `${testID}-clear` : undefined)}
          >
            <MaterialIcons
              name="close"
              size={iconSize('title-medium')}
              color={colors['color-on-surface-variant']}
              accessibilityElementsHidden
            />
          </Pressable>
        ) : null}
      </View>
      {errorKey !== undefined ? (
        <Text variant="body-small" tone="error" style={styles.message} accessibilityLiveRegion="polite">
          {t(errorKey)}
        </Text>
      ) : hintKey !== undefined ? (
        <Text variant="body-small" tone="secondary" style={styles.message}>
          {t(hintKey)}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: spacing.extraSmall },
  label: { marginLeft: spacing.extraSmall },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.medium,
    paddingVertical: spacing.small,
    borderRadius: shape.small,
    borderWidth: RING,
  },
  // The text style comes from the design system; padding zeroes React Native's own field inset without writing
  // a number (Number(spacing.noSpacing) is the token's "0").
  // Web (X5): kill the browser's default focus ring on the input itself (the inner black rectangle inside the
  // field). The focus indicator stays the field border turning primary (borderColor above, >= 3:1 in
  // docs/a11y/contrast.md). React Native's types allow only "solid" | "dotted" | "dashed" for outlineStyle —
  // never "none" — so a zero-width solid outline is the typed equivalent of outline-style: none; native
  // ignores outline* entirely, so Android/iOS are unaffected.
  input: {
    ...typeStyle('body-large'),
    flex: 1,
    padding: Number(spacing.noSpacing),
    color: colors['color-on-surface'],
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  toggle: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: { marginLeft: spacing.extraSmall },
});
