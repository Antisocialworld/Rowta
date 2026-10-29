// SwapTargetModal — modal picker to select a colleague when approving an open swap (D1; rules U7, X1, X6, X14).
// Reuses standard Rowta modal patterns, design tokens, and components.
import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextInstance,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';
import { Text } from './Text';
import { t } from '../i18n/en';
import { focusOn } from '../lib/a11y';
import { colors, shape, spacing } from '../theme/tokens';
import { CONTENT_MAX_WIDTH, iconSize } from '../theme/layout';

export type SwapTargetMember = {
  readonly userId: string;
  readonly displayName: string;
};

export type SwapTargetModalProps = {
  readonly visible: boolean;
  readonly members: readonly SwapTargetMember[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly submitting: boolean;
  readonly onRetry: () => void;
  readonly onConfirm: (targetUserId: string) => void;
  readonly onCancel: () => void;
  readonly testID?: string;
};

export function SwapTargetModal({
  visible,
  members,
  isLoading,
  isError,
  submitting,
  onRetry,
  onConfirm,
  onCancel,
  testID = 'swap-target-modal',
}: SwapTargetModalProps) {
  const headingRef = useRef<TextInstance>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Reset selected user when modal opens or closes
  useEffect(() => {
    if (visible) {
      setSelectedUserId(null);
      focusOn(headingRef.current);
    }
  }, [visible]);

  // Web keyboard: Escape closes modal
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, onCancel]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} testID={testID}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
          accessible
          accessibilityRole="button"
          accessibilityLabel={t('action.cancel')}
        />
        <View style={styles.card} accessibilityViewIsModal>
          <Text ref={headingRef} variant="title-large" accessibilityRole="header" style={styles.title}>
            {t('swap.targetModal.title')}
          </Text>
          <Text variant="body-medium" tone="secondary" style={styles.hint}>
            {t('swap.targetModal.hint')}
          </Text>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <Skeleton variant="text" />
              <Skeleton variant="block" />
            </View>
          ) : isError ? (
            <View style={styles.statusContainer}>
              <EmptyState kind="error" action={{ label: 'action.retry', onPress: onRetry }} />
            </View>
          ) : members.length === 0 ? (
            <View style={styles.statusContainer}>
              <EmptyState kind="empty" titleKey="swap.empty.title" bodyKey="swap.targetModal.empty" />
            </View>
          ) : (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {members.map((member) => {
                const isSelected = selectedUserId === member.userId;
                return (
                  <Pressable
                    key={member.userId}
                    style={[styles.memberRow, isSelected ? styles.memberRowSelected : undefined]}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={member.displayName}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => setSelectedUserId(member.userId)}
                    testID={`${testID}-member-${member.userId}`}
                  >
                    <Text variant="body-medium">{member.displayName}</Text>
                    {isSelected ? (
                      <MaterialIcons
                        name="check"
                        size={iconSize('body-medium')}
                        color={colors['color-on-surface']}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.actions}>
            <Button
              label="action.cancel"
              variant="ghost"
              fullWidth={false}
              onPress={onCancel}
              testID={`${testID}-cancel`}
            />
            <Button
              label="swap.targetModal.confirm"
              variant="primary"
              fullWidth={false}
              ready={selectedUserId !== null && !submitting}
              busy={submitting}
              onPress={() => {
                if (selectedUserId !== null) {
                  onConfirm(selectedUserId);
                }
              }}
              testID={`${testID}-confirm`}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Number(spacing.base),
  },
  card: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    maxHeight: '85%',
    backgroundColor: colors['color-surface'],
    borderRadius: Number(shape.large),
    padding: Number(spacing.base),
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  title: {
    marginBottom: Number(spacing.extraSmall),
  },
  hint: {
    marginBottom: Number(spacing.base),
  },
  loadingContainer: {
    paddingVertical: Number(spacing.large),
    gap: Number(spacing.base),
  },
  statusContainer: {
    paddingVertical: Number(spacing.base),
  },
  list: {
    maxHeight: 280,
  },
  listContent: {
    gap: Number(spacing.small),
    paddingVertical: Number(spacing.small),
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Number(spacing.base),
    borderRadius: Number(shape.small),
    backgroundColor: colors['color-surface-container-high'],
    minHeight: 44, // X6 accessible touch target
  },
  memberRowSelected: {
    backgroundColor: colors['color-primary-container'],
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Number(spacing.small),
    marginTop: Number(spacing.base),
  },
});
