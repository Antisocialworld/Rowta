// DeletedTeamsModal — modal sheet listing soft-deleted teams eligible for 30-day restore (rules U1, U7, X1, X3, X4, X6, X14; ADR 0018).
// Centering padding spacing.small, card maxHeight 85%, list in ScrollView with flexShrink: 1, Close button pinned outside.
import { useEffect, useRef } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextInstance,
} from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { Text } from '../../components/Text';
import { t } from '../../i18n/en';
import { focusOn } from '../../lib/a11y';
import { formatDisplayDate } from '../../lib/shift-time';
import { calculateDaysLeftToRestore } from '../../state/teams';
import type { DeletedTeamItem } from '../../lib/api';
import { colors, shape, spacing, state } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../../theme/layout';

export type DeletedTeamsModalProps = {
  readonly visible: boolean;
  readonly teams: readonly DeletedTeamItem[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly restoreBusyId: string | null;
  readonly onRetry: () => void;
  readonly onRestore: (teamId: string) => Promise<void>;
  readonly onClose: () => void;
  readonly testID?: string;
};

export function DeletedTeamsModal({
  visible,
  teams,
  isLoading,
  isError,
  restoreBusyId,
  onRetry,
  onRestore,
  onClose,
  testID = 'deleted-teams-modal',
}: DeletedTeamsModalProps) {
  const headingRef = useRef<TextInstance>(null);

  // Focus heading on open (rule U7, X4)
  useEffect(() => {
    if (visible) {
      focusOn(headingRef.current);
    }
  }, [visible]);

  // Web keyboard: Escape closes modal (rule X4)
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
      <View style={styles.scrim}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityLabel={t('action.close')}
          accessibilityRole="button"
        />
        <View style={styles.card} accessibilityViewIsModal testID="deleted-teams-section">
          <View style={styles.header}>
            <Text
              ref={headingRef}
              variant="headline-small"
              accessibilityRole="header"
              testID="deleted-teams-heading"
            >
              {t('teams.deleted.heading')}
            </Text>
            <Text variant="body-medium" tone="secondary">
              {t('teams.deleted.description')}
            </Text>
          </View>

          <ScrollView
            style={styles.listScroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {isLoading ? (
              <View style={styles.statusContainer}>
                <Skeleton variant="text" />
                <Skeleton variant="block" />
              </View>
            ) : isError ? (
              <View style={styles.statusContainer}>
                <EmptyState
                  kind="error"
                  action={{ label: 'action.retry', onPress: onRetry }}
                />
              </View>
            ) : teams.length === 0 ? (
              <View style={styles.statusContainer}>
                <EmptyState
                  kind="empty"
                  titleKey="teams.deleted.heading"
                  bodyKey="teams.deleted.empty"
                />
              </View>
            ) : (
              <View style={styles.list}>
                {teams.map((dTeam) => {
                  const daysLeft = calculateDaysLeftToRestore(dTeam.restoreUntil);
                  const dateFormatted = formatDisplayDate(dTeam.deletedAt);
                  const isBusy = restoreBusyId === dTeam.id;
                  return (
                    <Card
                      key={dTeam.id}
                      variant="flat"
                      testID={`deleted-team-card-${dTeam.id}`}
                    >
                      <View style={styles.teamRow}>
                        <View style={styles.teamInfo}>
                          <Text variant="title-medium" style={styles.teamName}>
                            {dTeam.name}
                          </Text>
                          <Text variant="body-small" tone="secondary">
                            {t('teams.deletedAt', { date: dateFormatted })}
                          </Text>
                          <Text variant="body-small" tone="secondary">
                            {t('teams.daysLeftToRestore', { count: daysLeft })}
                          </Text>
                        </View>
                        <Button
                          label="teams.restore.action"
                          variant="secondary"
                          fullWidth={false}
                          busy={isBusy}
                          onPress={() => void onRestore(dTeam.id)}
                          testID={`team-restore-${dTeam.id}`}
                        />
                      </View>
                    </Card>
                  );
                })}
              </View>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <Button
              label="action.close"
              variant="ghost"
              fullWidth={false}
              onPress={onClose}
              testID={`${testID}-close`}
            />
          </View>
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
    padding: Number(spacing.small),
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
    padding: Number(spacing.base),
    gap: Number(spacing.base),
  },
  header: {
    gap: Number(spacing.extraSmall),
    alignSelf: 'stretch',
  },
  listScroll: {
    flexShrink: 1,
  },
  scrollContent: {
    gap: Number(spacing.base),
  },
  statusContainer: {
    paddingVertical: Number(spacing.base),
  },
  list: {
    gap: Number(spacing.small),
  },
  teamRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Number(spacing.small),
  },
  teamInfo: {
    flex: 1,
    minWidth: 160,
    gap: Number(spacing.extraSmall),
  },
  teamName: {
    flex: 1,
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: Number(spacing.small),
  },
});

