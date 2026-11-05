// EmptyState — the designed empty, error and end states (rules U6, U8, U10, X1, X5, X6).
//
// Variants: empty | error — icon, title and body all come from catalog keys (a blank screen is a bug, so every
//           list view renders one of these instead of nothing).
// States:   none of its own; the optional action is a Button carrying busy/ready states.
// Props:    kind (chooses the icon), titleKey, bodyKey, hideBody, action {labelKey, onPress, busy?}, style.
// Icons:    decorative (hidden from assistive technology — the title and body already say it, X1).
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, spacing, shape } from '../theme/tokens';
import { iconSize } from '../theme/layout';
import { t, type MessageKey } from '../i18n/en';
import { Button } from './Button';
import { Text } from './Text';

export type EmptyStateKind = 'empty' | 'error';

const ICON: Record<EmptyStateKind, 'inbox' | 'error-outline'> = {
  empty: 'inbox',
  error: 'error-outline',
};

export type EmptyStateProps = {
  kind?: EmptyStateKind;
  titleKey?: MessageKey;
  bodyKey?: MessageKey;
  hideBody?: boolean;
  action?: { label: MessageKey; onPress: () => void; busy?: boolean };
  style?: StyleProp<ViewStyle>;
};

export function EmptyState({ kind = 'empty', titleKey, bodyKey, hideBody = false, action, style }: EmptyStateProps) {
  const title = titleKey ?? (kind === 'error' ? 'generic.error.title' : 'generic.empty.title');
  const body = bodyKey ?? (kind === 'error' ? 'generic.error.body' : 'generic.empty.body');
  return (
    <View style={[styles.root, style]}>
      <MaterialIcons
        name={ICON[kind]}
        size={iconSize('display-small')}
        color={colors['color-on-surface-variant']}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text variant="title-medium" style={styles.center}>
        {t(title)}
      </Text>
      {hideBody ? null : (
        <Text variant="body-medium" tone="secondary" style={styles.center}>
          {t(body)}
        </Text>
      )}
      {action !== undefined ? (
        <Button
          label={action.label}
          onPress={action.onPress}
          busy={action.busy ?? false}
          variant="secondary"
          fullWidth={false}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.small,
    paddingVertical: spacing.extraLarge,
    paddingHorizontal: spacing.base,
    borderRadius: shape.large,
    backgroundColor: colors['color-surface-container'],
  },
  center: { textAlign: 'center' },
});
