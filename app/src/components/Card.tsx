// Card — the surface Direction A is built on (card-first comfortable; rules U5, U6, X5, X6).
//
// Variants: raised (soft design-system shadow -> Android elevation, see theme/shadows.ts) | flat (fill only).
// States:   none of its own — it is presentational; interactive rows are their own components (ShiftCard), which
//           keeps the card free of focus, press and screen-reader semantics it must not claim.
// Spacing:  padding none | base | large, all from the spacing scale; radius from the shape scale.
// Props:    children, variant, padding, style, accessibility* pass-through for grouping.
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { colors, shape, spacing } from '../theme/tokens';
import { elevated } from '../theme/shadows';

export type CardProps = ViewProps & {
  variant?: 'raised' | 'flat';
  padding?: 'none' | 'base' | 'large';
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

const PADDING: Record<NonNullable<CardProps['padding']>, number> = {
  none: Number(spacing.noSpacing),
  base: spacing.base,
  large: spacing.extraLarge,
};

export function Card({ variant = 'raised', padding = 'base', style, children, ...rest }: CardProps) {
  return (
    <View
      {...rest}
      style={[
        styles.card,
        { backgroundColor: colors['color-surface-container'], padding: PADDING[padding] },
        variant === 'raised' ? elevated('soft') : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: shape.large,
    gap: spacing.small,
  },
});
