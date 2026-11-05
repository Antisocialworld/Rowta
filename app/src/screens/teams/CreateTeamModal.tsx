// CreateTeamModal — Phase 3 create-team modal (rules V1, V5, U1, U5, U7, U8, X3, X14; PRD 6.1, 8.2; Stage M2).
// Built on SheetModal: inherits centering padding, maxHeight 85%, ScrollView, and pinned footer.
// One labelled name input (auto-focused, U7), client validation through the SHARED createTeamSchema
// (V1), server 422 fields mapped through fieldErrorKey so raw server text never appears (V5).
//
// Idempotency-Key discipline (B1, ADR 0012): ONE key per submit ATTEMPT. ensureCreateKey() returns
// the current attempt's key (generating one only when none exists) so a RETRY of the same attempt
// reuses it; clearCreateKey() runs whenever the name changes (a changed body must never reuse a key
// — the server would answer 422 fingerprint_mismatch) and after a success. Never logged (S1).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { createTeamSchema } from '@rowta/shared';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { LiveRegion } from '../../components/LiveRegion';
import { SheetModal } from '../../components/SheetModal';
import { type MessageKey } from '../../i18n/en';
import { ApiError, errorTextKey, fieldErrorKey, teamsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import {
  shouldClearOnModalClose,
  shouldClearOnNameChange,
} from '../../lib/create-team-idempotency';
import { useTeams } from '../../state/teams';
import { spacing } from '../../theme/tokens';

export type CreateTeamModalProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly returnFocusRef?: { current: unknown } | null;
  readonly testID?: string;
};

export function CreateTeamModal({
  visible,
  onClose,
  returnFocusRef,
  testID = 'create-team-modal',
}: CreateTeamModalProps) {
  const nameRef = useRef<TextInputInstance>(null);
  const queryClient = useQueryClient();
  const selectTeam = useTeams((state) => state.selectTeam);
  const ensureCreateKey = useTeams((state) => state.ensureCreateKey);
  const clearCreateKey = useTeams((state) => state.clearCreateKey);
  const createKeyName = useTeams((state) => state.createKeyName);
  const createKeyLastOutcome = useTeams((state) => state.createKeyLastOutcome);
  const recordCreateOutcome = useTeams((state) => state.recordCreateOutcome);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [nameFieldError, setNameFieldError] = useState<MessageKey | null>(null);
  const [announcement, setAnnouncement] = useState<MessageKey | null>(null);

  useEffect(() => {
    if (visible) {
      if (createKeyName && !shouldClearOnModalClose(createKeyLastOutcome)) {
        setName(createKeyName);
      }
      focusOn(nameRef.current);
    }
  }, [visible, createKeyName, createKeyLastOutcome]);

  const handleClose = () => {
    if (shouldClearOnModalClose(createKeyLastOutcome)) {
      clearCreateKey();
      setName('');
    }
    setErrorKey(null);
    setNameFieldError(null);
    setAnnouncement(null);
    onClose();
  };

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
      const idempotencyKey = ensureCreateKey(name);
      const team = await teamsApi.createTeam(parsed.data, idempotencyKey);
      recordCreateOutcome('success');
      selectTeam(team.id);
      await queryClient.invalidateQueries({ queryKey: ['teams', 'list'] });
      await queryClient.refetchQueries({ queryKey: ['teams', 'list'] });
      await queryClient.invalidateQueries({ queryKey: ['teams'] });
      setAnnouncement('teams.toast.teamCreated');
      setName('');
      handleClose();
    } catch (error) {
      recordCreateOutcome(error);
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

  const footer = (
    <View style={styles.footerRow}>
      <Button
        label="action.cancel"
        variant="ghost"
        fullWidth={false}
        onPress={handleClose}
        testID="create-team-cancel"
      />
      <Button
        label="teams.create.submit"
        variant="primary"
        fullWidth={false}
        busy={busy}
        ready={name.trim().length > 0}
        reason="team.name.required"
        onPress={() => void onSubmit()}
        testID="create-team-submit"
      />
    </View>
  );

  return (
    <SheetModal
      visible={visible}
      onClose={handleClose}
      headingKey="teams.view.create.heading"
      returnFocusRef={returnFocusRef}
      testID={testID}
      cardTestID="create-team-section"
      headingTestID="create-team-heading"
      footer={footer}
    >
      <View style={styles.body}>
        <Input
          ref={nameRef}
          label="field.teamName"
          value={name}
          onChangeText={(value) => {
            setName(value);
            // A changed body must never reuse the previous attempt's idempotency key (ADR 0012).
            if (shouldClearOnNameChange(createKeyName, value)) {
              clearCreateKey();
            }
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
        {announcement !== null && announcement !== errorKey ? (
          <LiveRegion>{announcement}</LiveRegion>
        ) : null}
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Number(spacing.base),
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Number(spacing.small),
  },
});

