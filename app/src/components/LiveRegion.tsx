// LiveRegion — visible text that assistive technology reads when it CHANGES (rules X3, X7, U8).
//
// Politeness: polite (default — waits for a pause, used for errors, resend countdowns, status lines) |
//             assertive (only for blocking problems; X3 says errors are polite unless blocking).
// States: none of its own; the parent changes children and TalkBack announces the difference.
// Placement: directly under the control it describes (a field's message, a view's status line). For one-off
//            announcements with no visible text, callers use announce() from lib/a11y instead — never both for
//            the same message (TalkBack would read it twice).
// Props: children (catalog text), politeness, variant, tone, style.
import type { StyleProp, TextStyle } from 'react-native';
import { t, type MessageKey } from '../i18n/en';
import { Text, type TextTone } from './Text';

export type LiveRegionProps = {
  children: MessageKey;
  politeness?: 'polite' | 'assertive';
  variant?: Parameters<typeof Text>[0]['variant'];
  tone?: TextTone;
  style?: StyleProp<TextStyle>;
};

export function LiveRegion({ children, politeness = 'polite', variant = 'body-small', tone = 'secondary', style }: LiveRegionProps) {
  return (
    <Text variant={variant} tone={tone} accessibilityLiveRegion={politeness} style={style}>
      {t(children)}
    </Text>
  );
}
