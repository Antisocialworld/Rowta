// SheetModal — unified accessible modal sheet shell (rules U1, U7, X1, X3, X4, X6, X14; ADR 0018, ADR 0021).
// Provides consistent width/height budget, focus management, backdrop dismiss, web Escape listener,
// internal ScrollView with flexShrink: 1, and pinned footer outside the scroll area.
import { useEffect, useRef, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextInstance,
} from 'react-native';
import { Text } from './Text';
import { t, type MessageKey } from '../i18n/en';
import { focusOn } from '../lib/a11y';
import {
  SHEET_CENTERING_PADDING,
  SHEET_DIALOG_PADDING,
} from '../lib/sheet-layout';
import { colors, shape, spacing, state } from '../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../theme/layout';

export type SheetModalProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly headingKey: MessageKey;
  readonly descriptionKey?: MessageKey;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly anchor?: 'center' | 'top';
  readonly returnFocusRef?: { current: unknown } | null;
  readonly testID?: string;
  readonly cardTestID?: string;
  readonly headingTestID?: string;
};

export function SheetModal({
  visible,
  onClose,
  headingKey,
  descriptionKey,
  children,
  footer,
  anchor = 'center',
  returnFocusRef,
  testID = 'sheet-modal',
  cardTestID,
  headingTestID,
}: SheetModalProps) {
  const headingRef = useRef<TextInstance>(null);
  const wasVisible = useRef(visible);

  // Focus moves to heading on open (rules U7, X4)
  useEffect(() => {
    if (visible) {
      focusOn(headingRef.current);
    }
  }, [visible]);

  // Focus returns to trigger on close (rules U7, X14)
  useEffect(() => {
    if (wasVisible.current && !visible) {
      if (returnFocusRef?.current) {
        focusOn(returnFocusRef.current);
      }
    }
    wasVisible.current = visible;
  }, [visible, returnFocusRef]);

  // Web keyboard: Escape key dismisses modal (rule X4)
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID={testID}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.scrim, anchor === 'top' ? styles.scrimTop : styles.scrimCenter]}
      >
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessible
          accessibilityRole="button"
          accessibilityLabel={t('action.close')}
        />
        <View style={styles.card} accessibilityViewIsModal testID={cardTestID ?? `${testID}-card`}>
          <View style={styles.header}>
            <Text
              ref={headingRef}
              variant="headline-small"
              accessibilityRole="header"
              testID={headingTestID ?? `${testID}-heading`}
            >
              {t(headingKey)}
            </Text>
            {descriptionKey ? (
              <Text variant="body-medium" tone="secondary">
                {t(descriptionKey)}
              </Text>
            ) : null}
          </View>

          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    padding: SHEET_CENTERING_PADDING,
  },
  scrimCenter: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrimTop: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: Number(spacing.base),
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors['color-scrim'],
    opacity: state.disabledContent,
  },
  card: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    maxHeight: '85%',
    backgroundColor: colors['color-surface'],
    borderRadius: Number(shape.extraLarge),
    padding: SHEET_DIALOG_PADDING,
    gap: Number(spacing.base),
  },
  header: {
    gap: Number(spacing.extraSmall),
    alignSelf: 'stretch',
  },
  bodyScroll: {
    flexShrink: 1,
  },
  scrollContent: {
    gap: Number(spacing.base),
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Number(spacing.small),
    marginTop: Number(spacing.small),
  },
});
