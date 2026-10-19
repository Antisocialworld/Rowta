// Text — the only text primitive in the kit (rules U5, U7, X5, X7, U8).
//
// Variants: every type style in the owner's design system — display-*, headline-*, title-*, subtitle-*, body-*,
//           label-* (see app/src/theme/fonts.ts for the weight-to-family mapping).
// Tones:    default (on-surface) | secondary (on-surface-variant) | primary | onPrimary | success | warning |
//           error | inverse — every pairing is measured in docs/a11y/contrast.md (X5, U11e).
// States:   none of its own; parent states drive it. Font scaling is never capped (X7: 200% must fit).
// Ref:      forwarded, so a view can hand a heading to focusOn() after a view change (U7).
// Props:    variant, tone, plus every React Native Text prop (numberOfLines, selectable, accessibilityRole...).
// Strings:  children are already catalog text (t(...)) — this component never holds user-facing words (U8).
import { forwardRef } from 'react';
import { Text as RNText, type StyleProp, type TextInstance, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { colors } from '../theme/tokens';
import { typeStyle, type TypeStyleName } from '../theme/fonts';

export type TextTone = 'default' | 'secondary' | 'primary' | 'onPrimary' | 'success' | 'warning' | 'error' | 'inverse';

const TONE_COLOR: Record<TextTone, string> = {
  default: colors['color-on-surface'],
  secondary: colors['color-on-surface-variant'],
  primary: colors['color-primary'],
  onPrimary: colors['color-on-primary'],
  success: colors['color-success'],
  warning: colors['color-warning'],
  error: colors['color-error'],
  inverse: colors['color-inverse-on-surface'],
};

export type TextProps = Omit<RNTextProps, 'style'> & {
  variant?: TypeStyleName;
  tone?: TextTone;
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
};

export const Text = forwardRef<TextInstance, TextProps>(function Text(
  { variant = 'body-medium', tone = 'default', style, children, ...rest },
  ref,
) {
  return (
    <RNText {...rest} ref={ref} style={[typeStyle(variant), { color: TONE_COLOR[tone] }, style]}>
      {children}
    </RNText>
  );
});
