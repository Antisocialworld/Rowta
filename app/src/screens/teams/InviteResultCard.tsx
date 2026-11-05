// InviteResultCard — the ALWAYS-shown outcome of an automatic invite accept (owner decisions 1-3,
// 26 Oct 2026; PRD 8.2). One card, three states:
//   joined  "You joined <team>." (or the generic line when the name could not be fetched).
//   failed  the ONE uniform failure text — identical for every failure kind so it never reveals
//           which check failed (invalid, used, seat cap, wrong email; A5, A6).
//   retry   a network/timeout kept the memory token for a retry of the SAME attempt.
// The card is a POLITE live region (X3): the words are read once when they appear. Focus moves to
// the outcome line when the card mounts (U7). Nothing here ever shows a token (S1, A13).
import { useEffect, useRef } from 'react';
import { StyleSheet, View, type TextInstance } from 'react-native';
import { Button, Card, Text } from '../../components';
import { t } from '../../i18n/en';
import { focusOn } from '../../lib/a11y';
import type { InviteResult } from '../../state/teams';
import { colors, spacing } from '../../theme/tokens';

export type InviteResultCardProps = {
  result: InviteResult;
  /** Retry re-runs accept with the still-held token (only the 'retry' state still has one). */
  onRetry?: () => void;
  onDismiss: () => void;
  retryBusy?: boolean;
  testID?: string;
};

export function InviteResultCard({ result, onRetry, onDismiss, retryBusy = false, testID }: InviteResultCardProps) {
  const headingRef = useRef<TextInstance>(null);

  useEffect(() => {
    focusOn(headingRef.current);
  }, [result.kind]);

  const joined = result.kind === 'joined';
  const line =
    joined && result.teamName !== null
      ? t('team.invite.joined', { teamName: result.teamName })
      : joined
        ? t('team.invite.joinedGeneric')
        : result.kind === 'retry'
          ? t('team.invite.retry')
          : t('team.invite.failed');

  return (
    <Card testID={testID ?? 'invite-result'} accessibilityLiveRegion="polite" style={styles.card}>
      <View style={styles.stack}>
        <Text
          ref={headingRef}
          variant="title-medium"
          tone={joined ? 'success' : 'error'}
          accessibilityRole="header"
          testID={`${testID ?? 'invite-result'}-line`}
        >
          {line}
        </Text>
        {result.kind === 'retry' && onRetry !== undefined ? (
          <Button label="action.retryInvite" variant="secondary" busy={retryBusy} onPress={onRetry} />
        ) : null}
        <Button
          label="action.dismissInviteResult"
          variant="ghost"
          onPress={onDismiss}
          testID={`${testID ?? 'invite-result'}-dismiss`}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderColor: colors['color-outline'], borderWidth: 1 },
  stack: { gap: Number(spacing.base) },
});
