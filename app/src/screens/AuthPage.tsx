// AuthPage — the ONE auth page: a single centred card whose contents are conditional on the machine's view
// (rules U1, U2, U7, U9, X1; PRD 6.1, 8.1; Phase 1 rework item 1).
//
// The three FORMS — signIn | createAccount | forgotPassword — render inside this one card (not separate
// screens); the seven step views (codes, reset, magic link, invite) render in the same card. The old chrome
// title line is replaced by the logo; the visible heading under it keeps the screen-reader structure (header
// role) and the per-view focus target (U7, item 8): views whose AUTH_VIEWS.focus is 'heading' get focus here,
// views with a field focus their first input themselves on mount.
//
// Logo: the lettered blue-tile book from brand-source/logo.svg, shown via the app asset that pipeline builds
// from it (app/assets/app-icon-1024.png, BRANDING section 5) — no redraw, no recolour. 160 px, or 120 px when
// the window is narrower than 360 px (item 2), centred, accessible name from the catalog (brand.logo = "Rowta").
//
// Desktop/web (item 5): the page centres the card, the card is width 100% with maxWidth 400 and large padding;
// nothing stretches past the viewport, the page background stays color-surface, phone widths are untouched.
//
// Android hardware Back (item 7): the machine's back() — createAccount/forgotPassword return to signIn, other
// views pop one entry, signIn at the root refuses so the OS exits (U1). The chrome back icon shows only for
// non-form views with history; the forms carry their own "Back to sign in" link instead (item 3).
import { useEffect, useRef, type ReactElement } from 'react';
import {
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type TextInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, LiveRegion, Text } from '../components';
import { t } from '../i18n/en';
import { focusOn } from '../lib/a11y';
import { AUTH_VIEWS, isFormView, useAuthViewStore, type AuthView } from '../state/auth-view';
import { colors, spacing } from '../theme/tokens';
import logoSource from '../../assets/app-icon-1024.png';
import { AcceptInviteView } from './auth/AcceptInviteView';
import { ForgotView } from './auth/ForgotView';
import { MagicConfirmView } from './auth/MagicConfirmView';
import { MagicRequestView } from './auth/MagicRequestView';
import { MagicSentView } from './auth/MagicSentView';
import { ResetCodeView } from './auth/ResetCodeView';
import { ResetNewPasswordView } from './auth/ResetNewPasswordView';
import { SignInView } from './auth/SignInView';
import { SignUpView } from './auth/SignUpView';
import { VerifyCodeView } from './auth/VerifyCodeView';

const VIEWS_BY_NAME = {
  signIn: SignInView,
  createAccount: SignUpView,
  verifyCode: VerifyCodeView,
  forgotPassword: ForgotView,
  resetCode: ResetCodeView,
  resetPassword: ResetNewPasswordView,
  magicRequest: MagicRequestView,
  magicSent: MagicSentView,
  magicConfirm: MagicConfirmView,
  acceptInvite: AcceptInviteView,
} as const;

const VIEWS: Record<AuthView, () => ReactElement> = VIEWS_BY_NAME;

const CARD_MAX_WIDTH = 400;
const LOGO_DEFAULT = 160;
const LOGO_COMPACT = 120;
const PHONE_NARROW = 360;

export function AuthPage() {
  const view = useAuthViewStore((state) => state.view);
  const stack = useAuthViewStore((state) => state.stack);
  const message = useAuthViewStore((state) => state.message);
  const back = useAuthViewStore((state) => state.back);
  const headingRef = useRef<TextInstance>(null);
  const { width } = useWindowDimensions();
  const logoSize = width < PHONE_NARROW ? LOGO_COMPACT : LOGO_DEFAULT;
  const showChromeBack = !isFormView(view) && stack.length > 0;

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const moved = back();
      // false when the machine refuses (root) -> the listener returns false -> the OS exits the app (U1).
      return !moved;
    });
    return () => subscription.remove();
  }, [back]);

  useEffect(() => {
    // item 8: after a state switch, heading-focus views take focus here; field views focus on their own mount.
    if (AUTH_VIEWS[view].focus === 'heading') focusOn(headingRef.current);
  }, [view]);

  const Current = VIEWS[view];
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {showChromeBack ? (
            <View style={styles.topRow}>
              <Button
                label="action.back"
                icon="arrow-back"
                iconOnly
                variant="ghost"
                fullWidth={false}
                onPress={() => {
                  back();
                }}
              />
            </View>
          ) : null}
          <Card padding="large" style={styles.card}>
            <Image
              source={logoSource}
              style={{ width: logoSize, height: logoSize }}
              accessible
              accessibilityRole="image"
              accessibilityLabel={t('brand.logo')}
            />
            <Text ref={headingRef} variant="headline-small" accessibilityRole="header" style={styles.heading}>
              {t(AUTH_VIEWS[view].heading)}
            </Text>
            {message !== undefined ? (
              <LiveRegion style={styles.message}>{message}</LiveRegion>
            ) : null}
            <Current />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors['color-surface'] },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: Number(spacing.base) },
  topRow: { width: '100%', maxWidth: CARD_MAX_WIDTH, alignItems: 'flex-start', marginBottom: Number(spacing.small) },
  card: { width: '100%', maxWidth: CARD_MAX_WIDTH, alignItems: 'center' },
  heading: { textAlign: 'center' },
  message: { textAlign: 'center' },
});
