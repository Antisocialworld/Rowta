// SearchScreen — team-scoped search over people, shifts and activity (Phase 4; PRD 8.4).
// The query goes to the server exactly as typed (trimmed); the shared schema's minimum is mirrored
// here only to give a format message before a request. Server data is shown as received; all other
// words are catalog keys. Empty, prompt, loading and error are explicit states.
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type TextInstance, type TextInputInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SearchResultsPayload } from '@rowta/shared';
import { Badge, Button, Card, EmptyState, Input, LiveRegion, ShiftCard, Skeleton, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { ApiError, errorTextKey, shiftsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { SEARCH_QUERY_MIN_LENGTH } from '@rowta/shared';
import { useShiftNav } from '../../state/shift-nav';
import { useTeamMembers, useTeams } from '../../state/teams';
import { colors, spacing } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../../theme/layout';
import { ActivityRow } from './ActivityRow';
import { shiftCardData } from './CalendarScreen';

const ROLE_LABEL: Record<string, MessageKey> = { owner: 'role.owner', manager: 'role.manager', staff: 'role.staff' };
const ROLE_TONE: Record<string, 'primary' | 'neutral'> = { owner: 'primary', manager: 'neutral', staff: 'neutral' };
const SEARCH_SHIFTS_KEY: MessageKey = 'search.section.shifts';

export function SearchScreen() {
  const headingRef = useRef<TextInstance>(null);
  const inputRef = useRef<TextInputInstance>(null);
  const back = useShiftNav((state) => state.back);
  const open = useShiftNav((state) => state.open);
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const membersQuery = useTeamMembers(selectedTeamId);
  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResultsPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<MessageKey | null>(null);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);

  useEffect(() => {
    focusOn(headingRef.current);
  }, []);

  const run = async (raw: string): Promise<void> => {
    const trimmed = raw.trim();
    if (selectedTeamId === null) return;
    if (trimmed.length < SEARCH_QUERY_MIN_LENGTH) {
      setFieldError('search.query.tooShort');
      setErrorKey(null);
      focusOn(inputRef.current);
      return;
    }
    setFieldError(null);
    setErrorKey(null);
    setBusy(true);
    try {
      const found = await shiftsApi.search(selectedTeamId, trimmed);
      setResults(found);
      setLastQuery(trimmed);
    } catch (error) {
      setErrorKey(error instanceof ApiError ? errorTextKey(error) : 'generic.error');
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

  const names = new Map((membersQuery.data?.members ?? []).map((member) => [member.userId, member.displayName]));
  const total = results === null ? 0 : results.members.length + results.shifts.length + results.activity.length;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text ref={headingRef} variant="headline-small" accessibilityRole="header">
            {t('teams.view.search.heading')}
          </Text>
          <Input
            ref={inputRef}
            label="action.openSearch"
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setFieldError(null);
              setErrorKey(null);
            }}
            errorKey={fieldError ?? undefined}
            maxLength={100}
            returnKeyType="search"
            onSubmitEditing={() => void run(query)}
            testID="search-input"
          />
          <Button label="action.search" icon="search" busy={busy} onPress={() => void run(query)} testID="search-submit" />
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
                      onPress={() => open({ name: 'detail', shiftId: shift.id })}
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
          <Button label="action.back" variant="ghost" onPress={back} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors['color-surface'] },
  container: { flex: 1, alignItems: 'center', padding: Number(spacing.base) },
  content: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, gap: Number(spacing.base), paddingBottom: Number(spacing.base) },
  sections: { gap: Number(spacing.large) },
  section: { gap: Number(spacing.small) },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Number(spacing.base) },
});
