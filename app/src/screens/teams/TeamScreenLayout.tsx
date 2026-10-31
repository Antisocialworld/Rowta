// TeamScreenLayout — shared scroll wrapper for teams screens (Phase 3; rules U1, U3, U7, X6, X7; Task B).
// Wraps each teams screen in SafeAreaView -> KeyboardAvoidingView -> ScrollView -> centered content View.
// Enforces:
// 1. Full accessibility of all controls on small viewports (360 x 800) with flexGrow: 1 and handled taps.
// 2. Generous bottom padding (spacing.veryLarge = 32) so the last action button is never hidden under the gesture bar.
// 3. Centered column capped at CONTENT_MAX_WIDTH (400) matching AuthPage.
import { type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../../theme/layout';

export type TeamScreenLayoutProps = {
  readonly children: ReactNode;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly contentContainerStyle?: StyleProp<ViewStyle>;
};

export function TeamScreenLayout({
  children,
  testID,
  style,
  contentContainerStyle,
}: TeamScreenLayoutProps) {
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID={testID}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.content, style]}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors['color-surface'] },
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    padding: Number(spacing.base),
    paddingBottom: Number(spacing.veryLarge),
  },
  content: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    gap: Number(spacing.base),
  },
});

