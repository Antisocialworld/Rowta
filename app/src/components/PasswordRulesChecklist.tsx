// PasswordRulesChecklist — live checklist for password composition (decision 24 Oct 2026; rules U8, X1, X2, X3, X5).
//
// Shows the 4 required rules in display order:
// 1. Minimum of 8 characters (maximum stays 128)
// 2. Password must contain an uppercase letter
// 3. Password must contain a lowercase letter
// 4. Password must contain a number or a special character (#@>^%*+=$&)
//
// Each row displays met/not-met with an icon AND text (never colour alone, X5), has an accessible name
// and state (X1, X2), and announces state changes politely (X3).
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { PASSWORD_COMPOSITION_RULES, type PasswordRuleKey } from '@rowta/shared';
import { colors, spacing } from '../theme/tokens';
import { iconSize } from '../theme/layout';
import { announce } from '../lib/a11y';
import { t } from '../i18n/en';
import { Text } from './Text';

export type PasswordRulesChecklistProps = {
  password: string;
  testID?: string;
};

export function PasswordRulesChecklist({ password, testID }: PasswordRulesChecklistProps) {
  const previousMetRef = useRef<Record<PasswordRuleKey, boolean | null>>({
    'auth.password.tooShort': null,
    'auth.password.uppercase': null,
    'auth.password.lowercase': null,
    'auth.password.numberOrSpecial': null,
  });

  useEffect(() => {
    // Announce state changes politely when a rule flips (X3)
    for (const rule of PASSWORD_COMPOSITION_RULES) {
      const isMet = rule.test(password);
      const prev = previousMetRef.current[rule.key];
      if (prev !== null && prev !== isMet) {
        announce(`${t(rule.key)}: ${t(isMet ? 'auth.rule.met' : 'auth.rule.notMet')}`);
      }
      previousMetRef.current[rule.key] = isMet;
    }
  }, [password]);

  return (
    <View style={styles.container} testID={testID}>
      {PASSWORD_COMPOSITION_RULES.map((rule) => {
        const isMet = rule.test(password);
        const statusText = t(isMet ? 'auth.rule.met' : 'auth.rule.notMet');
        const ruleLabel = t(rule.key);
        return (
          <View
            key={rule.id}
            accessible
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isMet }}
            accessibilityLabel={`${ruleLabel}, ${statusText}`}
            style={styles.row}
            testID={`${testID ?? 'password-rule'}-${rule.id}`}
          >
            <MaterialIcons
              name={isMet ? 'check-circle' : 'radio-button-unchecked'}
              size={iconSize('body-medium')}
              color={isMet ? colors['color-success'] : colors['color-on-surface-variant']}
              accessibilityElementsHidden
            />
            <Text
              variant="body-small"
              tone={isMet ? 'primary' : 'secondary'}
              style={styles.ruleText}
            >
              {ruleLabel}
            </Text>
            <Text
              variant="label-small"
              tone={isMet ? 'success' : 'secondary'}
              style={styles.statusBadge}
            >
              {statusText}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.extraSmall,
    alignSelf: 'stretch',
    paddingVertical: spacing.extraSmall,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.small,
  },
  ruleText: {
    flex: 1,
  },
  statusBadge: {
    textTransform: 'uppercase',
  },
});
