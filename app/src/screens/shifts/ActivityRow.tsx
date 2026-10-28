// ActivityRow — one activity event as a card (Phase 4; PRD 8.3; rules U5, U8, X1, X5).
// The actor name and shift label are SERVER data shown as received; the kind words come from the
// catalog. One accessible node per event so TalkBack reads it in a single swipe.
import { StyleSheet, View } from 'react-native';
import type { ActivityEventPayload } from '@rowta/shared';
import { Card, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { formatShiftDay, formatShiftTimeRange } from '../../lib/shift-time';
import { spacing } from '../../theme/tokens';

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

export function ActivityRow({ event }: { event: ActivityEventPayload }) {
  const label = typeof event.data.label === 'string' ? event.data.label : '';
  const startsAt = typeof event.data.startsAt === 'string' ? event.data.startsAt : null;
  const endsAt = typeof event.data.endsAt === 'string' ? event.data.endsAt : null;
  const when =
    startsAt !== null && endsAt !== null
      ? `${formatShiftDay(startsAt)} ${formatShiftTimeRange(startsAt, endsAt)}`
      : formatShiftDay(event.createdAt);
  return (
    <Card variant="flat" testID={`activity-${event.id}`}>
      <View style={styles.body} accessible accessibilityLabel={[activityLine(event), label, when].join(', ')}>
        <Text variant="title-small">{activityLine(event)}</Text>
        {label.length > 0 ? <Text variant="body-medium">{label}</Text> : null}
        <Text variant="body-small" tone="secondary">
          {when}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.extraSmall },
});
