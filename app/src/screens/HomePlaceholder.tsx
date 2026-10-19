// HomePlaceholder — the signed-in branch of the root render for Phase 1 only (U2; PRD).
// Phase 2 replaces this with the real role-aware Dashboard (PRD 6.2) fed by the server. It exists now so the
// root conditional (AuthGate vs signed-in) is real code that the gallery and the size matrix can reach.
import { useEffect, useRef } from 'react';
import { StyleSheet, View, type TextInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text } from '../components';
import { t } from '../i18n/en';
import { focusOn } from '../lib/a11y';
import { useSessionStore } from '../state/session';
import { colors, spacing } from '../theme/tokens';

export function HomePlaceholder() {
  const signOut = useSessionStore((state) => state.signOut);
  const openGallery = useSessionStore((state) => state.openGallery);
  const headingRef = useRef<TextInstance>(null);

  useEffect(() => {
    focusOn(headingRef.current);
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Text ref={headingRef} variant="headline-small" accessibilityRole="header">
          {t('home.placeholder.title')}
        </Text>
        <Text variant="body-medium" tone="secondary" style={styles.body}>
          {t('home.placeholder.body')}
        </Text>
        <Button label="gallery.title" icon="widgets" variant="secondary" onPress={openGallery} />
        <Button label="action.signOut" variant="ghost" onPress={signOut} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors['color-surface'] },
  content: { padding: Number(spacing.base), gap: Number(spacing.base) },
  body: { marginBottom: Number(spacing.medium) },
});
