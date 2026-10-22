// ConfirmDialog — the accessible confirmation before anything important or destructive (rules X12, X4, X1, X14,
// U5, X6).
//
// Variants: neutral (primary confirm) | destructive (danger confirm — colour re-states the WORD "delete"-class
//           labels, never replaces them, X5).
// States:   open | closed (unmounted); the confirm button may be busy (spinner, repeat taps ignored, X14g).
// Focus (X4): moves to the dialog heading when it opens; Android back and scrim press are CANCEL (the safe
//           escape); the caller returns focus to whatever opened it inside onCancel/onConfirm.
// Buttons:  both are Button components, so pressed/focus/busy/not-ready all come from the one implementation;
//           cancel is never a "waiting" button and therefore never needs a reason.
// Width:    the dialog is width 100% capped at CONTENT_MAX_WIDTH and centred inside the scrim padding, so on a
//           wide desktop viewport it matches the auth card's column instead of spanning the browser (phones
//           keep today's width: viewport minus the scrim padding).
// Props:    visible, titleKey, messageKey, confirmLabel, cancelLabel, destructive, busy, onConfirm, onCancel,
//           testID.
import { useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, View, type TextInstance } from 'react-native';
import { colors, shape, spacing, state } from '../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../theme/layout';
import { focusOn } from '../lib/a11y';
import { t, type MessageKey } from '../i18n/en';
import { Button } from './Button';
import { Text } from './Text';

export type ConfirmDialogProps = {
  visible: boolean;
  titleKey: MessageKey;
  messageKey: MessageKey;
  confirmLabel: MessageKey;
  cancelLabel?: MessageKey;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
};

export function ConfirmDialog({
  visible,
  titleKey,
  messageKey,
  confirmLabel,
  cancelLabel = 'action.cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
  testID,
}: ConfirmDialogProps) {
  const headingRef = useRef<TextInstance>(null);

  useEffect(() => {
    if (visible) focusOn(headingRef.current);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
      <Pressable
        style={[styles.scrim, { backgroundColor: colors['color-scrim'], opacity: state.disabledContent }]}
        onPress={onCancel}
        accessible
        accessibilityRole="button"
        accessibilityLabel={t('action.cancel')}
        testID={testID !== undefined ? `${testID}-scrim` : undefined}
      />
      <View style={styles.centering} pointerEvents="box-none">
        <View testID={testID} style={[styles.dialog, { backgroundColor: colors['color-surface-container'] }]}>
          <Text ref={headingRef} variant="title-medium" accessibilityRole="header">
            {t(titleKey)}
          </Text>
          <Text variant="body-medium" tone="secondary">
            {t(messageKey)}
          </Text>
          <View style={styles.actions}>
            <Button label={cancelLabel} onPress={onCancel} variant="ghost" fullWidth={false} />
            <Button
              label={confirmLabel}
              onPress={onConfirm}
              variant={destructive ? 'danger' : 'primary'}
              busy={busy}
              fullWidth={false}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: StyleSheet.absoluteFill,
  centering: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.extraLarge,
  },
  dialog: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    borderRadius: shape.large,
    padding: spacing.extraLarge,
    gap: spacing.medium,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.small,
    marginTop: spacing.small,
  },
});
