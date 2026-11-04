// ActivityRow — one activity event as a card (Phase 4; PRD 8.3; rules U5, U8, X1, X5).
// The actor name and shift label are SERVER data shown as received; the kind words come from the
// catalog. One accessible node per event so TalkBack reads it in a single swipe.
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { ActivityEventPayload } from '@rowta/shared';
import { Card, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { formatShiftDay, formatShiftTimeRange } from '../../lib/shift-time';
import { colors, shape, spacing, state } from '../../theme/tokens';
import { RING, iconSize } from '../../theme/layout';

const KIND_LABEL: Record<string, MessageKey> = {
  'shift.created': 'activity.kind.created',
  'shift.updated': 'activity.kind.updated',
  'shift.deleted': 'activity.kind.deleted',
};

export function activityLine(event: ActivityEventPayload): string {
  const actor = event.actor?.displayName ?? t('activity.system');
  const kind = t(KIND_LABEL[event.kind] ?? 'activity.kind.other');
  return `${actor} ${kind}`;
}

export function ActivityRow({ event, onPress }: { event: ActivityEventPayload; onPress?: () => void }) {
  const [focused, setFocused] = useState(false);
  const label = typeof event.data.label === 'string' ? event.data.label : '';
  const startsAt = typeof event.data.startsAt === 'string' ? event.data.startsAt : null;
  const endsAt = typeof event.data.endsAt === 'string' ? event.data.endsAt : null;
  const when =
    startsAt !== null && endsAt !== null
      ? `${formatShiftDay(startsAt)} ${formatShiftTimeRange(startsAt, endsAt)}`
      : formatShiftDay(event.createdAt);
  const accessibleName = [activityLine(event), label, when].join(', ');
  const content = (
    <>
      <Text variant="title-small">{activityLine(event)}</Text>
      {label.length > 0 ? <Text variant="body-medium">{label}</Text> : null}
      <Text variant="body-small" tone="secondary">
        {when}
      </Text>
    </>
  );

  if (onPress === undefined) {
    return (
      <Card variant="flat" testID={`activity-${event.id}`}>
        <View style={styles.body} accessible accessibilityLabel={accessibleName}>
          {content}
        </View>
      </Card>
    );
  }

  return (
    <Pressable
      testID={`activity-${event.id}`}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibleName}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors['color-surface-container'] },
        {
          borderColor: focused ? colors['color-primary'] : colors['color-surface-container'],
          borderWidth: RING,
        },
        pressed && { opacity: 1 - state.pressed },
      ]}
    >
      <View style={styles.row}>
        <View style={[styles.body, styles.bodyFlex]}>{content}</View>
        <MaterialIcons
          name="chevron-right"
          size={iconSize('title-medium')}
          color={colors['color-on-surface-variant']}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </View>
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
    gap: spacing.small,
  },
  body: { gap: spacing.extraSmall },
  bodyFlex: { flex: 1 },
});
