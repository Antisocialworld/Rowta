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

const KIND_INFO: Record<string, { verbKey: MessageKey; tone: 'success' | 'primary' | 'error' | 'warning' | 'other' }> = {
  'shift.created': { verbKey: 'activity.kind.created', tone: 'success' },
  'shift.updated': { verbKey: 'activity.kind.updated', tone: 'primary' },
  'shift.deleted': { verbKey: 'activity.kind.deleted', tone: 'error' },
  'swap.requested': { verbKey: 'activity.kind.swapRequested', tone: 'warning' },
  'swap.approved': { verbKey: 'activity.kind.swapApproved', tone: 'success' },
  'swap.rejected': { verbKey: 'activity.kind.swapRejected', tone: 'error' },
  'swap.cancelled': { verbKey: 'activity.kind.swapCancelled', tone: 'error' },
  'team.deleted': { verbKey: 'activity.kind.teamDeleted', tone: 'error' },
  'team.transferred': { verbKey: 'activity.kind.teamTransferred', tone: 'primary' },
  'team.restored': { verbKey: 'activity.kind.teamRestored', tone: 'success' },
};

const TONE_STRIP: Record<string, string | undefined> = {
  success: colors['color-on-success-container'],
  primary: colors['color-on-primary-container'],
  error: colors['color-on-error-container'],
  warning: colors['color-on-warning-container'],
  other: undefined,
};

export function activityKindInfo(kind: string): { verbKey: MessageKey; tone: string } {
  const info = KIND_INFO[kind];
  if (info === undefined) return { verbKey: 'activity.kind.other', tone: 'other' };
  return { verbKey: info.verbKey, tone: info.tone };
}

export function activityLine(event: ActivityEventPayload): string {
  const actor = event.actor?.displayName ?? t('activity.system');
  const kind = t(activityKindInfo(event.kind).verbKey);
  return `${actor} ${kind}`;
}

export function ActivityRow({ event, onPress }: { event: ActivityEventPayload; onPress?: () => void }) {
  const [focused, setFocused] = useState(false);
  const kindInfo = activityKindInfo(event.kind);
  const label = typeof event.data.label === 'string' ? event.data.label : '';
  const stripColor = TONE_STRIP[kindInfo.tone];
  const showLabel =
    (event.kind === 'swap.requested' ||
      event.kind === 'swap.approved' ||
      event.kind === 'swap.rejected') &&
    label.length > 0;
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
      {showLabel ? <Text variant="body-medium">{label}</Text> : null}
      <Text variant="body-small" tone="secondary">
        {when}
      </Text>
    </>
  );

  if (onPress === undefined) {
    return (
      <Card
        variant="flat"
        testID={`activity-${event.id}`}
        style={
          stripColor ? [{ borderLeftWidth: 6, borderLeftColor: stripColor }] : undefined
        }
      >
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
        stripColor ? { borderLeftWidth: 6, borderLeftColor: stripColor } : null,
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
