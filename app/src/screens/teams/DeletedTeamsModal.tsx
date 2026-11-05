// DeletedTeamsModal — modal sheet listing soft-deleted teams eligible for 30-day restore (rules U1, U7, X1, X3, X4, X6, X14; ADR 0018, ADR 0021).
// Built on SheetModal: inherits centering padding, maxHeight 85%, ScrollView with flexShrink: 1, and pinned footer.
import { StyleSheet, View } from 'react-native';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Input } from '../../components/Input';
import { PinnedFooter } from '../../components/PinnedFooter';
import { PinnedHeader } from '../../components/PinnedHeader';
import { Skeleton } from '../../components/Skeleton';
import { Text } from '../../components/Text';
import { SheetModal } from '../../components/SheetModal';
import { t } from '../../i18n/en';
import { formatDisplayDate } from '../../lib/shift-time';
import { calculateDaysLeftToRestore } from '../../state/teams';
import { deletedTeamsViewState } from '../../lib/deleted-teams-logic';
import { filterDeletedTeamsByName } from './deleted-teams-filter';
import type { DeletedTeamItem } from '../../lib/api';
import { spacing } from '../../theme/tokens';

export type DeletedTeamsModalProps = {
  readonly visible: boolean;
  readonly teams: readonly DeletedTeamItem[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly restoreBusyId: string | null;
  readonly onRetry: () => void;
  readonly onRestore: (teamId: string) => Promise<void>;
  readonly onClose: () => void;
  readonly returnFocusRef?: { current: unknown } | null;
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
  returnFocusRef,
  testID = 'deleted-teams-modal',
}: DeletedTeamsModalProps) {
  const viewState = deletedTeamsViewState({
    isLoading,
    isError,
    count: teams.length,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const filteredTeams = filterDeletedTeamsByName(teams, searchQuery);

  const footer = (
    <View style={styles.footerWrapper}>
      <PinnedFooter label="action.close" onPress={onClose} variant="ghost" testID={`${testID}-close`} />
    </View>
  );

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      headingKey="teams.deleted.heading"
      descriptionKey="teams.deleted.description"
      returnFocusRef={returnFocusRef}
      testID={testID}
      cardTestID="deleted-teams-section"
      headingTestID="deleted-teams-heading"
      header={
        <PinnedHeader>
          <Input
            label="field.deletedTeamsSearch"
            value={searchQuery}
            onChangeText={setSearchQuery}
            testID="deleted-teams-search"
          />
        </PinnedHeader>
      }
      footer={footer}
    >
      {viewState === 'loading' ? (
        <View style={styles.statusContainer}>
          <Skeleton variant="text" />
          <Skeleton variant="block" />
        </View>
      ) : viewState === 'error' ? (
        <View style={styles.statusContainer}>
          <EmptyState
            kind="error"
            action={{ label: 'action.retry', onPress: onRetry }}
          />
        </View>
      ) : viewState === 'empty' ? (
        <View style={styles.statusContainer}>
          <EmptyState
            kind="empty"
            titleKey="teams.deleted.heading"
            bodyKey="teams.deleted.empty"
          />
        </View>
      ) : (
        <>
          {filteredTeams.length === 0 ? (
            <View style={styles.statusContainer}>
              <EmptyState kind="empty" titleKey="teams.deleted.search.empty" bodyKey="teams.deleted.empty" />
            </View>
          ) : (
            <View style={styles.list}>
              {filteredTeams.map((dTeam) => {
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
        </>
      )}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
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
  footerWrapper: {
    flex: 1,
  },
});
