// TransferOwnershipModal — modal picker to select a colleague and transfer team ownership (rules U5, U7, X1, X4, X14; ADR 0018).
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
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Text } from '../../components/Text';
import { t } from '../../i18n/en';
import { focusOn } from '../../lib/a11y';
import { colors, shape, spacing } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH, iconSize } from '../../theme/layout';

export type TransferMemberItem = {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: string;
};

export type TransferOwnershipModalProps = {
  readonly visible: boolean;
  readonly members: readonly TransferMemberItem[];
  readonly currentUserId?: string;
  readonly busy: boolean;
  readonly onConfirm: (targetUserId: string) => void;
  readonly onCancel: () => void;
  readonly testID?: string;
};

export function TransferOwnershipModal({
  visible,
  members,
  currentUserId,
  busy,
  onConfirm,
  onCancel,
  testID = 'transfer-ownership-modal',
}: TransferOwnershipModalProps) {
  const headingRef = useRef<TextInstance>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setSelectedUserId(null);
      focusOn(headingRef.current);
    }
  }, [visible]);

  const eligibleMembers = members.filter(
    (m) => m.role !== 'owner' && (currentUserId === undefined || m.userId !== currentUserId),
  );

  const selectedMember = eligibleMembers.find((m) => m.userId === selectedUserId);

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
              testID="transfer-ownership-heading"
            >
              {t('teams.transfer.title')}
            </Text>

            <Text variant="body-medium" tone="secondary">
              {t('teams.transfer.description')}
            </Text>

            {eligibleMembers.length === 0 ? (
              <EmptyState
                kind="empty"
                titleKey="teams.members.empty.title"
                bodyKey="teams.members.empty.body"
              />
            ) : (
              <View style={styles.list}>
                {eligibleMembers.map((member) => {
                  const isSelected = member.userId === selectedUserId;
                  return (
                    <Pressable
                      key={member.userId}
                      onPress={() => setSelectedUserId(member.userId)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ selected: isSelected, checked: isSelected }}
                      accessibilityLabel={`${member.displayName}, ${member.email}`}
                      testID={`transfer-member-${member.userId}`}
                    >
                      <Card variant={isSelected ? 'raised' : 'flat'}>
                        <View style={styles.memberRow}>
                          <View style={styles.memberInfo}>
                            <Text variant="title-medium">{member.displayName}</Text>
                            <Text variant="body-medium" tone="secondary">
                              {member.email}
                            </Text>
                            <Badge
                              label={member.role === 'manager' ? 'role.manager' : 'role.staff'}
                              tone="neutral"
                            />
                          </View>
                          {isSelected ? (
                            <MaterialIcons
                              name="check-circle"
                              size={iconSize('title-medium')}
                              color={colors['color-primary']}
                            />
                          ) : null}
                        </View>
                      </Card>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {selectedMember !== undefined ? (
              <Card variant="flat">
                <Text variant="body-medium" tone="secondary">
                  {t('teams.transfer.confirmMessage', { name: selectedMember.displayName })}
                </Text>
              </Card>
            ) : null}

            <View style={styles.actions}>
              <Button
                label="teams.transfer.confirmButton"
                variant="primary"
                ready={selectedMember !== undefined}
                reason={selectedMember === undefined ? 'teams.transfer.selectMember' : undefined}
                busy={busy}
                onPress={() => {
                  if (selectedUserId !== null) {
                    onConfirm(selectedUserId);
                  }
                }}
                testID="transfer-ownership-confirm"
              />
              <Button
                label="teams.transfer.cancelButton"
                variant="ghost"
                onPress={onCancel}
                testID="transfer-ownership-cancel"
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
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Number(spacing.base),
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    maxHeight: '85%',
    backgroundColor: colors['color-surface'],
    borderRadius: Number(shape.extraLarge),
    padding: Number(spacing.large),
    ...Platform.select({
      web: { boxShadow: '0 8px 32px rgba(0, 0, 0, 0.24)' },
      default: { elevation: 8 },
    }),
  },
  scrollContent: {
    gap: Number(spacing.base),
  },
  list: {
    gap: Number(spacing.small),
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Number(spacing.small),
  },
  memberInfo: {
    flexDirection: 'column',
    gap: Number(spacing.extraSmall),
    flexShrink: 1,
  },
  actions: {
    gap: Number(spacing.small),
    marginTop: Number(spacing.small),
  },
});
