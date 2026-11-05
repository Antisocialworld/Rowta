// ShiftCard — one shift as a card row (Direction A card-first; rules U5, U8, X1, X2, X5, X6).
//
// Data: role/day/time/member are SERVER strings shown as received (the catalog owns the app's own words, U8;
//       data is not translated here). The badge label is a catalog key the caller picks with its tone.
// Variants: static (no press) | pressable (when onPress is given).
// States: resting | pressed (token dim, no movement) | focused (RING border laid out from first render) |
//         selected (primary ring + accessibilityState.selected — X2: selection is never colour-only, and the
//         caller usually pairs it with a Badge or an icon).
// Accessible name: starts with the words visible on the card (role, day, time, member — WCAG 2.5.3, X14h); one
//       node per card so TalkBack reads a shift in a single swipe.
// Props: shift {role, day, time, member}, badge {label, tone}, selected, onPress, testID.
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, shape, spacing, state } from '../theme/tokens';
import { RING } from '../theme/layout';
import type { MessageKey } from '../i18n/en';
import { Avatar } from './Avatar';
import { Badge, type BadgeTone } from './Badge';
import { Text } from './Text';

export type ShiftCardData = {
  /** Server data: what the shift is for (e.g. a role name). */
  role: string;
  /** Server data: the day line, already formatted by the server/cache. */
  day: string;
  /** Server data: the time range, already formatted. */
  time: string;
  /** Server data: who the shift belongs to (drives the avatar initials too). */
  member: string;
};

export type ShiftCardProps = {
  shift: ShiftCardData;
  /** Catalog badge: the state word that keeps meaning out of bare colour (X5). */
  badge?: { label: MessageKey; tone?: BadgeTone };
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
};

export function ShiftCard({ shift, badge, selected = false, onPress, testID }: ShiftCardProps) {
  const [focused, setFocused] = useState(false);
  const accessibleName = [shift.role, shift.day, shift.time, shift.member].join(', ');
  const content = (
    <View style={styles.row}>
      <Avatar name={shift.member} size="md" decorative />
      <View style={styles.body}>
        <Text variant="title-small" numberOfLines={1}>
          {shift.role}
        </Text>
        <Text variant="body-small" tone="secondary" numberOfLines={2}>
          {[shift.day, shift.time].join(' ')}
        </Text>
        <Text variant="label-small" tone="secondary" numberOfLines={1}>
          {shift.member}
        </Text>
      </View>
      {badge !== undefined ? <Badge label={badge.label} tone={badge.tone} /> : null}
    </View>
  );

  const ring = selected ? colors['color-primary'] : undefined;

  if (onPress === undefined) {
    return (
      <View
        testID={testID}
        accessible
        accessibilityLabel={accessibleName}
        style={[styles.card, { backgroundColor: colors['color-surface-container'] }, selected && { borderColor: ring, borderWidth: RING }]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibleName}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors['color-surface-container'] },
        { borderColor: focused || selected ? (ring ?? colors['color-primary']) : colors['color-surface-container'], borderWidth: RING },
        pressed && { opacity: 1 - state.pressed },
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: shape.large,
    padding: spacing.base,
    gap: spacing.small,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.medium,
  },
  body: {
    flex: 1,
    gap: spacing.extraSmall,
  },
});
