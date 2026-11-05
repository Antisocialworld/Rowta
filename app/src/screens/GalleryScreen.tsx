// GalleryScreen — every kit component in every state, on one scrollable screen (Phase 1 step 4).
// Purpose: the human review surface for the component kit and the target the size-matrix capture script
// screenshots (PRD 6.3). Development builds only (P7, owner decision 28 Oct 2026): Root and the team
// list both gate it behind lib/dev-tools + __DEV__, so a release build can neither show nor open it.
// The size panel reports the live window and font scale so any phone can be
// compared against the PRD cases without guessing.
import { useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  EmptyState,
  Input,
  LiveRegion,
  ShiftCard,
  Skeleton,
  Text,
  Toast,
} from '../components';
import { t, type MessageKey } from '../i18n/en';
import { useAuthSession } from '../state/auth-session';
import { colors, spacing } from '../theme/tokens';
import { CONTENT_MAX_WIDTH } from '../theme/layout';
import { GALLERY_PEOPLE, GALLERY_SHIFTS } from './gallery-data';

const AVATAR_SIZES = ['sm', 'md', 'lg'] as const;

export function GalleryScreen() {
  const closeGallery = useAuthSession((state) => state.closeGallery);
  const { width, height, fontScale } = useWindowDimensions();
  const firstShift = GALLERY_SHIFTS[0]!;
  const firstPerson = GALLERY_PEOPLE[0]!;
  const [textValue, setTextValue] = useState('Sample text');
  const [toastVisible, setToastVisible] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [announceKey, setAnnounceKey] = useState<MessageKey>('gallery.badge.upcoming');
  const [chipSelected, setChipSelected] = useState(true);

  const section = (key: MessageKey) => (
    <Text variant="title-medium" accessibilityRole="header" style={styles.sectionTitle}>
      {t(key)}
    </Text>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <Text variant="headline-small" accessibilityRole="header">
            {t('gallery.title')}
          </Text>
          <Text variant="body-medium" tone="secondary">
            {t('gallery.body')}
          </Text>
          <Button label="action.back" icon="arrow-back" iconOnly variant="ghost" fullWidth={false} onPress={closeGallery} />

        {section('gallery.section.text')}
        <Text variant="display-large">{t('gallery.glyph')}</Text>
        <Text variant="headline-small">{t('gallery.section.text')}</Text>
        <Text variant="title-medium" tone="secondary">
          {t('gallery.section.status')}
        </Text>
        <Text variant="body-medium" tone="primary">
          {t('gallery.section.buttons')}
        </Text>
        <Text variant="label-large" tone="success">
          {t('gallery.badge.upcoming')}
        </Text>

        {section('gallery.section.buttons')}
        <Button label="action.signIn" onPress={() => undefined} />
        <Button label="action.continue" variant="secondary" onPress={() => undefined} />
        <Button label="action.back" variant="ghost" onPress={() => undefined} />
        <Button label="action.delete" variant="danger" onPress={() => undefined} />
        <Button label="action.signIn" ready={false} reason="auth.ready.signIn" onNotReady={() => undefined} onPress={() => undefined} />
        <Button label="gallery.demo.busy" busy onPress={() => undefined} />
        <Button label="action.back" icon="arrow-back" iconOnly variant="ghost" fullWidth={false} onPress={() => undefined} />
        <Button label="action.edit" icon="edit" onPress={() => undefined} />

        {section('gallery.section.inputs')}
        <Input label="field.email" variant="email" value={textValue} onChangeText={setTextValue} />
        <Input label="field.email" variant="email" value="not-an-email" onChangeText={() => undefined} errorKey="auth.email.invalid" />
        <Input label="field.code" variant="code" value="123" onChangeText={() => undefined} hintKey="auth.code.hint" />
        <Input label="field.name" variant="name" value="Read only" onChangeText={() => undefined} editable={false} />

        {section('gallery.section.cards')}
        {GALLERY_SHIFTS.map((entry) => (
          <ShiftCard key={entry.card.role} shift={entry.card} badge={entry.badge} />
        ))}
        <ShiftCard
          shift={firstShift.card}
          badge={firstShift.badge}
          selected
          onPress={() => undefined}
        />
        <Card variant="raised">
          <Text variant="body-medium">{t('gallery.body')}</Text>
        </Card>
        <Card variant="flat">
          <Text variant="body-medium">{t('gallery.matrix.current')}</Text>
        </Card>

        {section('gallery.section.status')}
        <View style={styles.row}>
          {GALLERY_PEOPLE.map((person, index) => (
            <Avatar key={person} name={person} size={AVATAR_SIZES[index] ?? 'md'} />
          ))}
          <Avatar name={firstPerson} size="md" decorative />
        </View>
        <View style={styles.row}>
          <Badge label="gallery.badge.upcoming" tone="primary" />
          <Badge label="gallery.badge.open" tone="warning" />
          <Badge label="generic.error.title" tone="error" />
          <Badge label="toast.saved" tone="success" />
          <Badge label="gallery.section.text" tone="neutral" />
        </View>
        <View style={styles.row}>
          <Chip label="gallery.badge.upcoming" selected={chipSelected} onPress={() => setChipSelected((value) => !value)} />
          <Chip label="gallery.badge.open" selected={false} onPress={() => undefined} />
          <Chip label="gallery.section.text" selected={false} disabled onPress={() => undefined} />
        </View>
        <View style={styles.row}>
          <Skeleton variant="circle" />
          <Skeleton variant="block" style={styles.skeletonBlock} />
        </View>
        <Skeleton variant="text" />
        <EmptyState kind="empty" />
        <EmptyState kind="error" action={{ label: 'action.retry', onPress: () => undefined }} />
        <Button
          label={toastVisible ? 'gallery.hideToast' : 'gallery.showToast'}
          variant="secondary"
          onPress={() => setToastVisible((value) => !value)}
        />
        <Toast
          visible={toastVisible}
          message="toast.saved"
          dismissible
          onDismiss={() => setToastVisible(false)}
          action={{ label: 'gallery.demo.announce', onPress: () => undefined }}
        />
        <Button
          label="gallery.demo.announce"
          variant="ghost"
          onPress={() => setAnnounceKey((key) => (key === 'gallery.badge.upcoming' ? 'gallery.badge.open' : 'gallery.badge.upcoming'))}
        />
        <LiveRegion>{announceKey}</LiveRegion>

        {section('gallery.section.overlays')}
        <Button label="gallery.openSheet" variant="secondary" onPress={() => setSheetVisible(true)} />
        <BottomSheet visible={sheetVisible} onClose={() => setSheetVisible(false)} titleKey="gallery.title">
          <Text variant="body-medium">{t('gallery.body')}</Text>
          <Button label="action.close" onPress={() => setSheetVisible(false)} />
        </BottomSheet>
        <Button label="gallery.openDialog" variant="secondary" onPress={() => setDialogVisible(true)} />
        <ConfirmDialog
          visible={dialogVisible}
          titleKey="generic.error.title"
          messageKey="generic.error.body"
          confirmLabel="action.delete"
          destructive
          onConfirm={() => setDialogVisible(false)}
          onCancel={() => setDialogVisible(false)}
        />

        {section('gallery.section.size')}
        <Text variant="title-small">{t('gallery.matrix.current')}</Text>
        <Text variant="body-medium" tone="secondary">
          {`${width} x ${height} pt, font scale ${fontScale}`}
        </Text>
      </View>
    </ScrollView>
  </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors['color-surface'] },
  scroll: { flex: 1 },
  container: {
    alignItems: 'center',
    padding: Number(spacing.base),
  },
  content: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    gap: Number(spacing.base),
  },
  sectionTitle: { marginTop: Number(spacing.medium) },
  row: { flexDirection: 'row', alignItems: 'center', gap: Number(spacing.small), flexWrap: 'wrap' },
  skeletonBlock: { width: 120, height: 48 },
});
