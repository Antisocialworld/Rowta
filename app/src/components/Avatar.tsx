// Avatar — the person chip (rules U5, X1, X5, X7).
//
// Variants: initials (default) | image (a uri with the initials as the fallback underneath).
// States:   none of its own; a failed image simply shows the initials (no spinner for a face).
// Sizes:    sm | md | lg — token-derived (32, 44, 64 dp: veryLarge, veryLarge+medium, veryLarge x2), never
//           literals in the file (U5).
// Accessibility: by default the avatar is ONE node whose name is the person's name (X1); `decorative` hides it
//           entirely for assistive technology when the same name is already written next to it (X1, and the
//           common case in lists).
// Props:    name (display data from the server, NOT catalog text), uri, size, decorative, style.
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, shape, spacing } from '../theme/tokens';
import { Text } from './Text';

export type AvatarSize = 'sm' | 'md' | 'lg';

const SIZE: Record<AvatarSize, number> = {
  sm: spacing.veryLarge, // 32
  md: spacing.veryLarge + spacing.medium, // 44, also the minimum touch target (X6)
  lg: spacing.veryLarge * 2, // 64
};

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return '';
  const first = words[0]?.charAt(0) ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : (words[0]?.charAt(1) ?? '');
  return (first + last).toUpperCase();
}

export type AvatarProps = {
  /** The person's display name (server data). */
  name: string;
  uri?: string;
  size?: AvatarSize;
  decorative?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Avatar({ name, uri, size = 'md', decorative = false, style }: AvatarProps) {
  const dimension = SIZE[size];
  const initials = initialsOf(name);
  const accessibility = decorative
    ? ({
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants',
      } as const)
    : ({ accessible: true, accessibilityLabel: name } as const);

  return (
    <View
      {...accessibility}
      style={[
        styles.circle,
        { width: dimension, height: dimension, backgroundColor: colors['color-primary-container'] },
        style,
      ]}
    >
      {uri !== undefined && uri.length > 0 ? (
        <Image
          source={{ uri }}
          style={styles.image}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : initials.length > 0 ? (
        <Text variant="label-medium" style={styles.initials} numberOfLines={1}>
          {initials}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: StyleSheet.absoluteFill,
  initials: { color: colors['color-on-primary-container'] },
});
