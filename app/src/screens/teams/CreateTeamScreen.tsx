// CreateTeamScreen — Phase 3 create-team form (rules V1, V5, U5, U7, U8, X3; PRD 6.1, 8.2).
// One labelled name input (auto-focused, U7), client validation through the SHARED createTeamSchema
// (V1), server 422 fields mapped through fieldErrorKey so raw server text never appears (V5).
//
// Idempotency-Key discipline (B1, ADR 0012): ONE key per submit ATTEMPT. ensureCreateKey() returns
// the current attempt's key (generating one only when none exists) so a RETRY of the same attempt
// reuses it; clearCreateKey() runs whenever the name changes (a changed body must never reuse a key
// — the server would answer 422 fingerprint_mismatch) and after a success. Never logged (S1).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { createTeamSchema } from '@rowta/shared';
import { Button, Input, LiveRegion, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { ApiError, errorTextKey, fieldErrorKey, teamsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { useTeams } from '../../state/teams';
import { useTeamsView } from '../../state/teams-view';
import { colors, spacing } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../../theme/layout';

export function CreateTeamScreen() {
  const nameRef = useRef<TextInputInstance>(null);
  const queryClient = useQueryClient();
  const back = useTeamsView((state) => state.back);
  const selectTeam = useTeams((state) => state.selectTeam);
  const ensureCreateKey = useTeams((state) => state.ensureCreateKey);
  const clearCreateKey = useTeams((state) => state.clearCreateKey);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [nameFieldError, setNameFieldError] = useState<MessageKey | null>(null);
  const [announcement, setAnnouncement] = useState<MessageKey | null>(null);

  useEffect(() => {
    focusOn(nameRef.current);
  }, []);

  const onSubmit = async (): Promise<void> => {
    const parsed = createTeamSchema.safeParse({ name: name.trim() });
    if (!parsed.success) {
      const issues = parsed.error.flatten().fieldErrors;
      const first = issues.name?.[0];
      const key: MessageKey = first !== undefined ? fieldErrorKey(first) : 'team.name.required';
      setNameFieldError(key);
      setErrorKey(null);
      setAnnouncement(key);
      focusOn(nameRef.current);
      return;
    }
    setErrorKey(null);
    setNameFieldError(null);
    setBusy(true);
    setAnnouncement(null);
    try {
      const idempotencyKey = ensureCreateKey();
      const team = await teamsApi.createTeam(parsed.data, idempotencyKey);
      clearCreateKey();
      selectTeam(team.id);
      await queryClient.invalidateQueries({ queryKey: ['teams'] });
      setAnnouncement('teams.toast.teamCreated');
      back();
    } catch (error) {
      if (error instanceof ApiError) {
        setNameFieldError(error.fields?.name !== undefined ? fieldErrorKey(error.fields.name) : null);
        const key = errorTextKey(error);
        setErrorKey(error.fields?.name !== undefined ? null : key);
        setAnnouncement(key);
      } else {
        setErrorKey('generic.error');
        setAnnouncement('generic.error');
      }
      focusOn(nameRef.current);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.content}>
          <Text variant="headline-small" accessibilityRole="header">
            {t('teams.view.create.heading')}
          </Text>
          <Input
            ref={nameRef}
            label="field.teamName"
            value={name}
            onChangeText={(value) => {
              setName(value);
              // A changed body must never reuse the previous attempt's idempotency key (ADR 0012).
              clearCreateKey();
              setErrorKey(null);
              setNameFieldError(null);
            }}
            variant="name"
            errorKey={nameFieldError ?? undefined}
            maxLength={80}
            testID="create-team-name"
          />
          {errorKey !== null ? (
            <LiveRegion tone="error">{errorKey}</LiveRegion>
          ) : null}
          <Button
            label="teams.create.submit"
            busy={busy}
            ready={name.trim().length > 0}
            reason="team.name.required"
            onPress={() => void onSubmit()}
            testID="create-team-submit"
          />
          <Button label="action.cancel" variant="ghost" onPress={back} />
          {announcement !== null && announcement !== errorKey ? (
            <LiveRegion>{announcement}</LiveRegion>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors['color-surface'] },
  container: { flex: 1, alignItems: 'center', padding: Number(spacing.base) },
  content: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, gap: Number(spacing.base) },
});
