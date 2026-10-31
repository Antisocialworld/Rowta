// CreateTeamScreen — Phase 3 create-team form (rules V1, V5, U5, U7, U8, X3; PRD 6.1, 8.2).
// One labelled name input (auto-focused, U7), client validation through the SHARED createTeamSchema
// (V1), server 422 fields mapped through fieldErrorKey so raw server text never appears (V5).
//
// Idempotency-Key discipline (B1, ADR 0012): ONE key per submit ATTEMPT. ensureCreateKey() returns
// the current attempt's key (generating one only when none exists) so a RETRY of the same attempt
// reuses it; clearCreateKey() runs whenever the name changes (a changed body must never reuse a key
// — the server would answer 422 fingerprint_mismatch) and after a success. Never logged (S1).
import { useEffect, useRef, useState } from 'react';
import { type TextInputInstance } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { createTeamSchema } from '@rowta/shared';
import { Button, Input, LiveRegion, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { ApiError, errorTextKey, fieldErrorKey, teamsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { useTeams } from '../../state/teams';
import { useTeamsView } from '../../state/teams-view';
import { TeamScreenLayout } from './TeamScreenLayout';

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
      await queryClient.invalidateQueries({ queryKey: ['teams', 'list'] });
      await queryClient.refetchQueries({ queryKey: ['teams', 'list'] });
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
    <TeamScreenLayout testID="team-create-screen">
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
    </TeamScreenLayout>
  );
}
