// AccountMenu — shared icon-only account button and modal sheet (rules U1, U5, U7, X1, X4, X6, X14; ADR 0018).
// Reuses SheetModal (which implements the DeleteTeamModal / TransferOwnershipModal modal pattern with existing design tokens).
import { useRef, useState } from 'react';
import { StyleSheet, View, type ViewInstance } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Button } from './Button';
import { SheetModal } from './SheetModal';
import { Text } from './Text';
import { t } from '../i18n/en';
import { authApi } from '../lib/api';
import { useAuthSession } from '../state/auth-session';
import { MIN_TOUCH_TARGET } from '../theme/layout';
import { spacing } from '../theme/tokens';

export type AccountMenuProps = {
  readonly testID?: string;
};

export function AccountMenu({ testID = 'account-button' }: AccountMenuProps) {
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<ViewInstance>(null);
  const signOut = useAuthSession((state) => state.signOut);

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.me(),
    staleTime: 5 * 60 * 1000,
  });

  const userName = meQuery.data?.displayName ?? '';

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
              label="action.cancel"
              variant="ghost"
              onPress={() => setVisible(false)}
              testID="account-cancel"
            />
          </View>
        </View>
      </SheetModal>
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
  actions: {
    gap: Number(spacing.small),
    marginTop: Number(spacing.small),
  },
});

