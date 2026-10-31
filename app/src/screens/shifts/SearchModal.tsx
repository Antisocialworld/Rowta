// SearchModal — team-scoped search modal sheet (Phase 4, Stage M4a; PRD 8.4; rules U1, U7, X14; ADR 0018, ADR 0021).
// Top-anchored SheetModal (anchor="top") providing live team-wide search over people, shifts and activity.
// Selecting a shift navigates to shift detail and closes the search sheet.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { SEARCH_QUERY_MIN_LENGTH } from '@rowta/shared';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Input } from '../../components/Input';
import { LiveRegion } from '../../components/LiveRegion';
import { ShiftCard } from '../../components/ShiftCard';
import { Skeleton } from '../../components/Skeleton';
import { Text } from '../../components/Text';
import { SheetModal } from '../../components/SheetModal';
import { t, type MessageKey } from '../../i18n/en';
import { ApiError, errorTextKey, shiftsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { shiftQueryKeys } from '../../lib/shift-cache';
import { useShiftNav } from '../../state/shift-nav';
import { useTeamMembers, useTeams } from '../../state/teams';
import { useSearchModal } from '../../state/search-modal';
import { spacing } from '../../theme/tokens';
import { ActivityRow } from './ActivityRow';
import { shiftCardData } from './CalendarScreen';

const ROLE_LABEL: Record<string, MessageKey> = {
  owner: 'role.owner',
  manager: 'role.manager',
  staff: 'role.staff',
};
const ROLE_TONE: Record<string, 'primary' | 'neutral'> = {
  owner: 'primary',
  manager: 'neutral',
  staff: 'neutral',
};
const SEARCH_SHIFTS_KEY: MessageKey = 'search.section.shifts';

export type SearchModalProps = {
  readonly visible?: boolean;
  readonly onClose?: () => void;
  readonly returnFocusRef?: { current: unknown } | null;
  readonly testID?: string;
};

export function SearchModal(props: SearchModalProps) {
  const storeVisible = useSearchModal((state) => state.visible);
  const storeClose = useSearchModal((state) => state.close);
  const storeReturnFocusRef = useSearchModal((state) => state.returnFocusRef);

  const visible = props.visible ?? storeVisible;
  const onClose = props.onClose ?? storeClose;
  const returnFocusRef = props.returnFocusRef ?? storeReturnFocusRef;
  const testID = props.testID ?? 'search-modal';

  const inputRef = useRef<TextInputInstance>(null);
  const openShift = useShiftNav((state) => state.open);
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const membersQuery = useTeamMembers(selectedTeamId);

  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<MessageKey | null>(null);

  const searchQuery = useQuery({
    queryKey: shiftQueryKeys.search(selectedTeamId ?? '', lastQuery ?? ''),
    queryFn: () => shiftsApi.search(selectedTeamId as string, lastQuery as string),
    enabled: selectedTeamId !== null && lastQuery !== null && lastQuery.length >= SEARCH_QUERY_MIN_LENGTH,
  });

  const results = searchQuery.data ?? null;
  const busy = searchQuery.isFetching;
  const errorKey = searchQuery.isError
    ? searchQuery.error instanceof ApiError
      ? errorTextKey(searchQuery.error)
      : 'generic.error'
    : null;

  useEffect(() => {
    if (visible) {
      focusOn(inputRef.current);
    }
  }, [visible]);

  const handleClose = () => {
    setQuery('');
    setLastQuery(null);
    setFieldError(null);
    onClose();
  };

  const run = (raw: string): void => {
    const trimmed = raw.trim();
    if (selectedTeamId === null) return;
    if (trimmed.length < SEARCH_QUERY_MIN_LENGTH) {
      setFieldError('search.query.tooShort');
      focusOn(inputRef.current);
      return;
    }
    setFieldError(null);
    if (lastQuery === trimmed) {
      void searchQuery.refetch();
    } else {
      setLastQuery(trimmed);
    }
  };

  const names = new Map((membersQuery.data?.members ?? []).map((member) => [member.userId, member.displayName]));
  const total = results === null ? 0 : results.members.length + results.shifts.length + results.activity.length;

  const footer = (
    <Button
      label="action.close"
      variant="ghost"
      fullWidth={false}
      onPress={handleClose}
      testID="search-close"
    />
  );

  return (
    <SheetModal
      visible={visible}
      onClose={handleClose}
      headingKey="teams.view.search.heading"
      anchor="top"
      returnFocusRef={returnFocusRef}
      testID={testID}
      cardTestID="search-modal-card"
      headingTestID="search-modal-heading"
      footer={footer}
    >
      <View style={styles.body}>
        <Input
          ref={inputRef}
          label="action.openSearch"
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setFieldError(null);
          }}
          errorKey={fieldError ?? undefined}
          maxLength={100}
          returnKeyType="search"
          onSubmitEditing={() => void run(query)}
          testID="search-input"
        />
        <Button
          label="action.search"
          icon="search"
          busy={busy}
          onPress={() => void run(query)}
          testID="search-submit"
        />

        {busy ? <Skeleton variant="block" /> : null}

        {!busy && errorKey !== null ? (
          <EmptyState
            kind="error"
            bodyKey={errorKey}
            action={{ label: 'action.retry', onPress: () => void run(query) }}
          />
        ) : null}

        {!busy && errorKey === null && results === null ? (
          <EmptyState kind="empty" titleKey="search.prompt.title" bodyKey="search.prompt.body" />
        ) : null}

        {!busy && errorKey === null && results !== null && total === 0 ? (
          <EmptyState kind="empty" titleKey="search.empty.title" bodyKey="search.empty.body" />
        ) : null}

        {!busy && errorKey === null && results !== null && total > 0 ? (
          <View style={styles.sections}>
            {results.members.length > 0 ? (
              <View style={styles.section}>
                <Text variant="title-medium" accessibilityRole="header">
                  {t('search.section.members')}
                </Text>
                {results.members.map((member) => (
                  <Card key={member.userId} variant="flat">
                    <View style={styles.row}>
                      <Text variant="title-small">{member.displayName}</Text>
                      <Badge label={ROLE_LABEL[member.role] ?? 'role.staff'} tone={ROLE_TONE[member.role] ?? 'neutral'} />
                    </View>
                  </Card>
                ))}
              </View>
            ) : null}

            {results.shifts.length > 0 ? (
              <View style={styles.section}>
                <Text variant="title-medium" accessibilityRole="header">
                  {t('search.section.shifts')}
                </Text>
                {results.shifts.map((shift) => (
                  <ShiftCard
                    key={shift.id}
                    shift={shiftCardData(shift, names.get(shift.assignedUserId) ?? '')}
                    onPress={() => {
                      openShift({ name: 'detail', shiftId: shift.id });
                      handleClose();
                    }}
                  />
                ))}
              </View>
            ) : null}

            {results.activity.length > 0 ? (
              <View style={styles.section}>
                <Text variant="title-medium" accessibilityRole="header">
                  {t('search.section.activity')}
                </Text>
                {results.activity.map((event) => (
                  <ActivityRow key={event.id} event={event} />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {lastQuery !== null ? <LiveRegion>{SEARCH_SHIFTS_KEY}</LiveRegion> : null}
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Number(spacing.base),
  },
  sections: {
    gap: Number(spacing.large),
  },
  section: {
    gap: Number(spacing.small),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Number(spacing.base),
  },
});

