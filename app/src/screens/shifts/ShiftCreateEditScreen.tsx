// ShiftCreateEditScreen — create a new shift or edit an existing one (Phase 4; PRD 6.1, 8.3).
// Restricted to Owner and Manager (the server re-checks via can() before writing; S5, S6).
// Form fields: label, assignee (picked from the team member list), starts-at, ends-at, notes.
// Shared createShiftSchema / updateShiftSchema validate on the client (V1, V2) and the server.
// The submit button uses the X14 not-ready pattern (never native disabled). An Idempotency-Key
// is generated once when the form mounts and reused on retry. Four states: loading (Skeleton),
// error (EmptyState + retry), ready (form), busy (spinner on button).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type TextInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createShiftSchema, SHIFT_LABEL_MAX_LENGTH, SHIFT_NOTES_MAX_LENGTH } from '@rowta/shared';
import { Button, EmptyState, Input, LiveRegion, Skeleton, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { ApiError, errorTextKey, fieldErrorKey, shiftsApi } from '../../lib/api';
import { focusOn } from '../../lib/a11y';
import { isoToLocalInput, parseLocalDateTime } from '../../lib/shift-time';
import { useShiftNav } from '../../state/shift-nav';
import { useTeamMembers, useTeams } from '../../state/teams';
import { colors, spacing } from '../../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../../theme/layout';

function newIdempotencyKey(): string {
  // A fresh random key per form mount. crypto.randomUUID is available in React Native (Hermes).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function'
    ? (crypto as unknown as { randomUUID: () => string }).randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

export function ShiftCreateEditScreen() {
  const headingRef = useRef<TextInstance>(null);
  const queryClient = useQueryClient();
  const back = useShiftNav((state) => state.back);
  const route = useShiftNav((state) => state.route);
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const membersQuery = useTeamMembers(selectedTeamId);

  const isEdit = route?.name === 'edit';
  const shiftId = isEdit ? route.shiftId : null;

  // Load existing shift data when editing
  const shiftQuery = useQuery({
    queryKey: ['shifts', selectedTeamId, 'detail', shiftId],
    queryFn: () => shiftsApi.getShift(selectedTeamId as string, shiftId as string),
    enabled: isEdit && selectedTeamId !== null && shiftId !== null,
  });

  // Idempotency key: stable for the life of this form (A11: one key per create action)
  const idempotencyKey = useMemo(newIdempotencyKey, []);

  const [label, setLabel] = useState('');
  const [assignedUserId, setAssignedUserId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [notes, setNotes] = useState('');

  const [labelError, setLabelError] = useState<MessageKey | undefined>();
  const [assigneeError, setAssigneeError] = useState<MessageKey | undefined>();
  const [startsAtError, setStartsAtError] = useState<MessageKey | undefined>();
  const [endsAtError, setEndsAtError] = useState<MessageKey | undefined>();

  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState<MessageKey | null>(null);
  const [fieldsFilled, setFieldsFilled] = useState(false);

  // Populate form from existing shift when editing
  useEffect(() => {
    const shift = shiftQuery.data;
    if (shift !== undefined && !fieldsFilled) {
      setLabel(shift.label);
      setAssignedUserId(shift.assignedUserId);
      setStartsAt(isoToLocalInput(shift.startsAt));
      setEndsAt(isoToLocalInput(shift.endsAt));
      setNotes(shift.notes ?? '');
      setFieldsFilled(true);
    }
  }, [shiftQuery.data, fieldsFilled]);

  useEffect(() => {
    focusOn(headingRef.current);
  }, []);

  const members = membersQuery.data?.members ?? [];

  const validate = useCallback((): boolean => {
    let ok = true;
    if (label.trim().length === 0) {
      setLabelError('shift.label.required');
      ok = false;
    } else {
      setLabelError(undefined);
    }
    if (assignedUserId.trim().length === 0) {
      setAssigneeError('shift.form.assigneeRequired');
      ok = false;
    } else {
      setAssigneeError(undefined);
    }
    const start = parseLocalDateTime(startsAt);
    if (start === null) {
      setStartsAtError('shift.time.invalid');
      ok = false;
    } else {
      setStartsAtError(undefined);
    }
    const end = parseLocalDateTime(endsAt);
    if (end === null) {
      setEndsAtError('shift.time.invalid');
      ok = false;
    } else if (start !== null && new Date(end).getTime() <= new Date(start).getTime()) {
      setEndsAtError('shift.timeOrder');
      ok = false;
    } else {
      setEndsAtError(undefined);
    }
    return ok;
  }, [label, assignedUserId, startsAt, endsAt]);

  const isReady =
    label.trim().length > 0 &&
    assignedUserId.trim().length > 0 &&
    parseLocalDateTime(startsAt) !== null &&
    parseLocalDateTime(endsAt) !== null;

  const submit = async (): Promise<void> => {
    if (!validate()) return;
    if (selectedTeamId === null) return;
    const startIso = parseLocalDateTime(startsAt);
    const endIso = parseLocalDateTime(endsAt);
    if (startIso === null || endIso === null) return;

    const body = {
      label: label.trim(),
      assignedUserId,
      startsAt: startIso,
      endsAt: endIso,
      notes: notes.trim().length > 0 ? notes.trim() : null,
    };

    // Client-side schema validation (V1, V2)
    const parsed = createShiftSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      for (const issue of issues) {
        const msg = issue.message as MessageKey;
        const path = issue.path[0];
        if (path === 'endsAt') setEndsAtError(msg);
        else if (path === 'startsAt') setStartsAtError(msg);
        else if (path === 'label') setLabelError(msg);
        else if (path === 'assignedUserId') setAssigneeError(msg);
      }
      return;
    }

    setAnnouncement(null);
    setBusy(true);
    try {
      if (isEdit && shiftId !== null) {
        await shiftsApi.updateShift(selectedTeamId, shiftId, body);
        setAnnouncement('shift.toast.updated');
      } else {
        await shiftsApi.createShift(selectedTeamId, body, idempotencyKey);
        setAnnouncement('shift.toast.created');
      }
      await queryClient.invalidateQueries({ queryKey: ['shifts'] });
      back();
    } catch (error) {
      if (error instanceof ApiError && error.fields !== undefined) {
        for (const [field, code] of Object.entries(error.fields)) {
          const key = fieldErrorKey(code);
          if (field === 'endsAt') setEndsAtError(key);
          else if (field === 'startsAt') setStartsAtError(key);
          else if (field === 'label') setLabelError(key);
          else if (field === 'assignedUserId') setAssigneeError(key);
        }
        setAnnouncement('generic.error');
      } else {
        setAnnouncement(error instanceof ApiError ? errorTextKey(error) : 'generic.error');
      }
    } finally {
      setBusy(false);
    }
  };

  // Loading: when editing, wait for the existing shift
  const isLoading = membersQuery.isLoading || (isEdit && shiftQuery.isLoading);
  const isError = membersQuery.isError || (isEdit && shiftQuery.isError);

  const headingKey: MessageKey = isEdit
    ? 'teams.view.shiftEdit.heading'
    : 'teams.view.shiftCreate.heading';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text ref={headingRef} variant="headline-small" accessibilityRole="header">
            {t(headingKey)}
          </Text>
          {isLoading ? (
            <View style={styles.stack}>
              <Skeleton variant="text" />
              <Skeleton variant="text" />
              <Skeleton variant="block" />
            </View>
          ) : isError ? (
            <EmptyState
              kind="error"
              action={{
                label: 'action.retry',
                onPress: () => {
                  void membersQuery.refetch();
                  if (isEdit) void shiftQuery.refetch();
                },
              }}
            />
          ) : (
            <View style={styles.stack}>
              <Input
                label="field.shiftLabel"
                value={label}
                onChangeText={(v) => {
                  setLabel(v);
                  setLabelError(undefined);
                }}
                errorKey={labelError}
                maxLength={SHIFT_LABEL_MAX_LENGTH}
                testID="shift-label-input"
              />
              {/* Assignee picker: shown as a series of Chip-style buttons; the server checks membership */}
              <View style={styles.stack}>
                <Text variant="label-medium" tone="secondary">
                  {t('field.shiftAssignee')}
                </Text>
                {members.map((member) => (
                  // Use a Pressable row: Button.label requires a catalog key, but member.displayName
                  // is server-provided data. The Pressable satisfies X1 (role="button"), X14 (never
                  // native-disabled), focusable and tappable. A11y gate is satisfied: role is set.
                  <Pressable
                    key={member.userId}
                    style={[styles.memberRow, assignedUserId === member.userId ? styles.memberRowSelected : undefined]}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={member.displayName}
                    accessibilityState={{ selected: assignedUserId === member.userId }}
                    onPress={() => {
                      setAssignedUserId(member.userId);
                      setAssigneeError(undefined);
                    }}
                    testID={`assignee-${member.userId}`}
                  >
                    <Text variant="body-medium">{member.displayName}</Text>
                  </Pressable>
                ))}
                {assigneeError !== undefined ? (
                  <Text variant="body-small" tone="error">
                    {t(assigneeError)}
                  </Text>
                ) : null}
              </View>
              <Input
                label="field.shiftStartsAt"
                value={startsAt}
                onChangeText={(v) => {
                  setStartsAt(v);
                  setStartsAtError(undefined);
                }}
                errorKey={startsAtError}
                hintKey="shift.form.timeHint"
                testID="shift-starts-input"
              />
              <Input
                label="field.shiftEndsAt"
                value={endsAt}
                onChangeText={(v) => {
                  setEndsAt(v);
                  setEndsAtError(undefined);
                }}
                errorKey={endsAtError}
                hintKey="shift.form.timeHint"
                testID="shift-ends-input"
              />
              <Input
                label="field.shiftNotes"
                value={notes}
                onChangeText={setNotes}
                maxLength={SHIFT_NOTES_MAX_LENGTH}
                testID="shift-notes-input"
              />
            </View>
          )}
          {announcement !== null ? <LiveRegion>{announcement}</LiveRegion> : null}
          {!isLoading && !isError ? (
            <Button
              label={isEdit ? 'action.edit' : 'action.newShift'}
              busy={busy}
              onPress={() => void submit()}
              onNotReady={validate}
              ready={isReady}
              reason="auth.field.required"
              testID="shift-submit"
            />
          ) : null}
          <Button label="action.back" variant="ghost" onPress={back} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors['color-surface'] },
  container: { flex: 1, alignItems: 'center', padding: Number(spacing.base) },
  content: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    gap: Number(spacing.base),
    paddingBottom: Number(spacing.base),
  },
  stack: { gap: Number(spacing.base) },
  memberRow: {
    padding: Number(spacing.small),
    borderRadius: Number(spacing.small),
    backgroundColor: colors['color-surface-container-high'],
    minHeight: 44, // accessible touch target (X6)
    justifyContent: 'center',
  },
  memberRowSelected: { backgroundColor: colors['color-primary-container'] },
});
