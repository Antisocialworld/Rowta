// DeleteTeamModal — modal confirmation requiring typed team name (rules U5, U7, X1, X4, X14; ADR 0018).
import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextInstance,
} from 'react-native';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Text } from '../../components/Text';
import { t } from '../../i18n/en';
import { focusOn } from '../../lib/a11y';
import { colors, shape, spacing, state } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../../theme/layout';

export type DeleteTeamModalProps = {
  readonly visible: boolean;
  readonly teamName: string;
  readonly busy: boolean;
  readonly onConfirm: (confirmName: string) => void;
  readonly onCancel: () => void;
  readonly testID?: string;
};

export function DeleteTeamModal({
  visible,
  teamName,
  busy,
  onConfirm,
  onCancel,
  testID = 'delete-team-modal',
}: DeleteTeamModalProps) {
  const headingRef = useRef<TextInstance>(null);
  const [typedName, setTypedName] = useState('');

  useEffect(() => {
    if (visible) {
      setTypedName('');
      focusOn(headingRef.current);
    }
  }, [visible]);

  const matches = typedName.trim() === teamName.trim();
  const showMismatch = typedName.length > 0 && !matches;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      testID={testID}
    >
      <View style={styles.scrim}>
        <Pressable
          style={styles.backdrop}
          onPress={onCancel}
          accessibilityLabel={t('action.cancel')}
          accessibilityRole="button"
        />
        <View style={styles.card} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <Text
              ref={headingRef}
              variant="headline-small"
              accessibilityRole="header"
              testID="delete-team-heading"
            >
              {t('teams.delete.title')}
            </Text>

            <Text variant="body-medium" tone="secondary">
              {t('teams.delete.description', { name: teamName })}
            </Text>

            <Input
              label="field.teamName"
              value={typedName}
              onChangeText={setTypedName}
              variant="text"
              editable={!busy}
              errorKey={showMismatch ? 'teams.delete.mismatch' : undefined}
              testID="delete-team-input"
            />

            <View style={styles.actions}>
              <Button
                label="teams.delete.confirmButton"
                variant="danger"
                ready={matches}
                reason={!matches ? 'teams.delete.mismatch' : undefined}
                busy={busy}
                onPress={() => onConfirm(typedName.trim())}
                testID="delete-team-confirm"
              />
              <Button
                label="teams.delete.cancelButton"
                variant="ghost"
                onPress={onCancel}
                testID="delete-team-cancel"
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Number(spacing.base),
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
    padding: Number(spacing.large),
  },
  scrollContent: {
    gap: Number(spacing.base),
  },
  actions: {
    gap: Number(spacing.small),
    marginTop: Number(spacing.small),
  },
});
