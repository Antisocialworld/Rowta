// BillingBackButton — shared back arrow on billing screens, placed top right on the same row as the title.
// Reuses the one Button component: icon="arrow-back", iconOnly, variant="ghost", label action.back.
// The Button box enforces MIN_TOUCH_TARGET (44pt) hit area; iconOnly squares it to 44x44.
import { Button } from './Button';

export type BillingBackButtonProps = {
  readonly onPress: () => void;
  readonly testID?: string;
  readonly accessibilityRole?: 'button';
};

export function BillingBackButton({ onPress, testID }: BillingBackButtonProps) {
  return (
    <Button
      label="action.back"
      icon="arrow-back"
      iconOnly
      variant="ghost"
      fullWidth={false}
      onPress={onPress}
      testID={testID}
    />
  );
}
