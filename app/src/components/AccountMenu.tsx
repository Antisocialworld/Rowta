// AccountMenu — shared icon-only account button and modal sheet (rules U1, U5, U7, X1, X4, X6, X14; ADR 0018).
// Reuses SheetModal (which implements the DeleteTeamModal / TransferOwnershipModal modal pattern with existing design tokens).
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type ViewInstance } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Button } from './Button';
import { DeleteAccountModal } from './DeleteAccountModal';
import { SheetModal } from './SheetModal';
import { Text } from './Text';
import { t, type MessageKey } from '../i18n/en';
import { authApi } from '../lib/api';
import { billingApi } from '../api/billing';
import { useAuthSession } from '../state/auth-session';
import { useTeamsView } from '../state/teams-view';
import { MIN_TOUCH_TARGET, iconSize } from '../theme/layout';
import { colors, spacing, state } from '../theme/tokens';

export type AccountMenuProps = {
  readonly testID?: string;
};

export function AccountMenu({ testID = 'account-button' }: AccountMenuProps) {
  const [visible, setVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const triggerRef = useRef<ViewInstance>(null);
  const signOut = useAuthSession((state) => state.signOut);
  const teamsViewGo = useTeamsView((state) => state.go);

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.me(),
    staleTime: 5 * 60 * 1000,
  });

  const accountQuery = useQuery({
    queryKey: ['billing', 'account'],
    queryFn: () => billingApi.accountStatus(),
    enabled: meQuery.data !== null,
    staleTime: 0, // billing is never cached
    refetchOnWindowFocus: false,
  });

  const userName = meQuery.data?.displayName ?? '';
  const account = accountQuery.data?.account ?? null;
  const hasAccount = account !== null;

  const statusKey: Record<string, MessageKey> = {
    active: 'billing.account.status.active',
    trialing: 'billing.account.status.trialing',
    past_due: 'billing.account.status.past_due',
    read_only: 'billing.account.status.read_only',
    cancelled: 'billing.account.status.cancelled',
  };

  const statusLabel = account
    ? t(statusKey[account.status] ?? 'billing.account.status.active')
    : '';
  let statusLine = statusLabel;
  if (account?.status === 'trialing' && account.trialEndsAt) {
    const days = Math.max(0, Math.ceil((new Date(account.trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    statusLine = `${statusLabel} · ${days} days left`;
  }

  return (
    <View style={styles.wrapper}>
      <Button
        ref={triggerRef}
        label="action.account"
        icon="account-circle"
        iconOnly
        variant="ghost"
        fullWidth={false}
        onPress={() => setVisible(true)}
        testID={testID}
      />
      <SheetModal
        visible={visible}
        onClose={() => setVisible(false)}
        headingKey="action.account"
        returnFocusRef={triggerRef}
        testID="account-sheet"
      >
        <View style={styles.sheetContent}>
          {userName ? (
            <Text variant="body-medium" tone="secondary" testID="account-signed-in-as">
              {t('teams.user.signedInAs', { name: userName })}
            </Text>
          ) : null}

          {hasAccount && account ? (
            <Pressable
              onPress={() => {
                setVisible(false);
                teamsViewGo('billing');
              }}
              accessible
              accessibilityRole="button"
              accessibilityLabel={
                statusLine
                  ? `${t('billing.account.title')}, ${statusLine}`
                  : t('billing.account.title')
              }
              testID="account-billing-row"
              style={({ pressed }) => [
                styles.accountRow,
                pressed && { opacity: 1 - state.pressed },
              ]}
            >
              <View style={styles.accountTextContainer}>
                <Text variant="body-medium">{t('billing.account.title')}</Text>
                <Text variant="body-small" tone="secondary">{statusLine}</Text>
              </View>
              <MaterialIcons
                name="chevron-right"
                size={iconSize('headline-small')}
                color={colors['color-primary']}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            </Pressable>
          ) : null}

          <View style={styles.actions}>
            <Button
              label="action.signOut"
              variant="danger"
              onPress={() => {
                setVisible(false);
                void signOut();
              }}
              testID="team-sign-out"
            />
            <Button
              label="action.deleteAccount"
              variant="ghost"
              onPress={() => {
                setVisible(false);
                setDeleteModalVisible(true);
              }}
              testID="account-delete-button"
            />
            <Button
              label="action.cancel"
              variant="ghost"
              onPress={() => setVisible(false)}
              testID="account-cancel"
            />
          </View>
        </View>
      </SheetModal>
      <DeleteAccountModal
        visible={deleteModalVisible}
        onClose={() => setDeleteModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexShrink: 0,
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheetContent: {
    gap: Number(spacing.base),
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Number(spacing.extraSmall),
    marginBottom: Number(spacing.small),
    paddingBottom: Number(spacing.small),
    minHeight: MIN_TOUCH_TARGET,
    borderBottomWidth: 1,
  },
  accountTextContainer: {
    flex: 1,
    gap: Number(spacing.extraSmall),
  },
  actions: {
    gap: Number(spacing.small),
    marginTop: Number(spacing.small),
  },
});
