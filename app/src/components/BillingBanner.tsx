// BillingBanner — neutral read-only / seat-limit banner shown to non-paying members (D3).
// No amounts, no payment data. Links to BillingScreen where appropriate.
// Imports siblings directly to avoid the components/index.ts -> BillingBanner -> components/index.ts require cycle.
import { StyleSheet, View, type TextStyle } from 'react-native';
import { Button } from './Button';
import { Card } from './Card';
import { Text } from './Text';
import { t, type MessageKey } from '../i18n/en';
import { spacing } from '../theme/tokens';

export type BillingBannerKind = 'seat_limit' | 'read_only' | 'trial_ending' | 'payment_late' | 'read_only_until_payer' | 'pay_to_unlock';

export function BillingBanner({ kind, onGoToBilling, days }: { kind: BillingBannerKind; onGoToBilling?: () => void; days?: number }) {
  let titleKey: MessageKey;
  let bodyKey: MessageKey;
  let bodyParams: Record<string, string | number> | undefined;
  let buttonKey: MessageKey | null;

  switch (kind) {
    case 'seat_limit':
      titleKey = 'billing.seatLimitReached';
      bodyKey = 'billing.seatLimitReached';
      buttonKey = null;
      break;
    case 'read_only':
      titleKey = 'billing.account.status.read_only';
      bodyKey = 'billing.readOnlyBanner';
      buttonKey = onGoToBilling ? 'billing.card.goToBilling' : null;
      break;
    case 'trial_ending':
      titleKey = 'billing.account.status.trialing';
      bodyKey = 'billing.dashboardBanner';
      bodyParams = days !== undefined ? { days } : undefined;
      buttonKey = onGoToBilling ? 'billing.card.goToBilling' : null;
      break;
    case 'payment_late':
      titleKey = 'billing.account.status.past_due';
      bodyKey = 'billing.dashboardPaymentLate';
      buttonKey = onGoToBilling ? 'billing.card.goToBilling' : null;
      break;
    case 'read_only_until_payer':
      titleKey = 'billing.account.status.read_only';
      bodyKey = 'billing.restricted.readOnlyUntilPayerGeneric';
      buttonKey = null;
      break;
    case 'pay_to_unlock':
      titleKey = 'billing.account.status.read_only';
      bodyKey = 'billing.restricted.payToUnlock';
      buttonKey = onGoToBilling ? 'billing.restricted.payNow' : null;
      break;
  }

  return (
    <Card variant="flat" style={styles.banner}>
      <View style={styles.body}>
        <Text variant="body-medium" style={styles.title} accessibilityRole="header">
          {t(titleKey)}
        </Text>
        <Text variant="body-small" tone="secondary">
          {t(bodyKey, bodyParams)}
        </Text>
      </View>
      {buttonKey && onGoToBilling ? (
        <Button
          label={buttonKey}
          variant="secondary"
          onPress={onGoToBilling}
          testID="billing-banner-go-to-billing"
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  banner: { marginHorizontal: spacing.base, marginBottom: spacing.small },
  body: { gap: spacing.extraSmall },
  title: { fontWeight: '600' as TextStyle['fontWeight'] },
});
