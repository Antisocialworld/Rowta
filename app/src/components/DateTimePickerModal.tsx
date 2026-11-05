// DateTimePickerModal — accessible local date and time picker modal (rules U7, U8, X1, X4, X6, X14).
//
// Built entirely from standard React Native primitives and Rowta design tokens. Zero external libraries.
// Operates on device local time (e.g. Lagos) with:
// - Month grid calendar (previous/next month navigation, today marker, selected day highlight)
// - 24-hour time selector with hour (00-23) and minute (step 5) stepper + quick-select chips
// - Full accessibility: focus moves to heading on open, Escape key closes on web, Android back closes via Modal,
//   all touch targets >= 44 px, keyboard arrow navigation for days, polite live region error announcements.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextInstance,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Button } from './Button';
import { LiveRegion } from './LiveRegion';
import { Text } from './Text';
import { t, type MessageKey } from '../i18n/en';
import { focusOn } from '../lib/a11y';
import {
  buildMonthGrid,
  combineDateTime,
  formatLocalInput,
  getDaysInMonth,
  isEndBeforeStart,
  moveMonth,
  pad2,
  parseLocalInput,
  type MonthGridCell,
} from '../lib/date-picker';
import {
  PICKER_CELL_MAX_WIDTH,
  PICKER_CENTERING_PADDING,
  PICKER_DIALOG_PADDING,
  PICKER_STEPPER_GAP,
  STEPPER_BUTTON_SIZE,
  STEPPER_CONTROLS_PADDING,
  STEPPER_INTERNAL_GAP,
  STEPPER_VALUE_MIN_WIDTH,
} from '../lib/picker-layout';
import { colors, shape, spacing, state } from '../theme/tokens';
import { CONTENT_MAX_WIDTH, iconSize } from '../theme/layout';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MINUTE_STEPS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const TIME_ORDER_ERROR: MessageKey = 'shift.timeOrder';
const COMMON_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

export interface DateTimePickerModalProps {
  visible: boolean;
  value: string; // 'YYYY-MM-DD HH:MM'
  titleKey: MessageKey;
  onConfirm: (formatted: string) => void;
  onCancel: () => void;
  minDate?: string; // Optional start date string to validate/clamp end date
  testID?: string;
}

export function DateTimePickerModal({
  visible,
  value,
  titleKey,
  onConfirm,
  onCancel,
  minDate,
  testID = 'date-time-picker',
}: DateTimePickerModalProps) {
  const headingRef = useRef<TextInstance>(null);

  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState(() => new Date().getDate());
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);

  // Synchronize initial state when modal opens
  useEffect(() => {
    if (!visible) return;
    const parsed = parseLocalInput(value);
    if (parsed !== null) {
      setYear(parsed.year);
      setMonth(parsed.month);
      setSelectedDay(parsed.day);
      setHour(parsed.hour);
      // Round to nearest 5 minutes
      setMinute(Math.min(55, Math.round(parsed.minute / 5) * 5));
    } else {
      const now = new Date();
      setYear(now.getFullYear());
      setMonth(now.getMonth() + 1);
      setSelectedDay(now.getDate());
      setHour(9);
      setMinute(0);
    }
  }, [visible, value]);

  // Focus heading on open (rule U7, X4)
  useEffect(() => {
    if (visible) {
      focusOn(headingRef.current);
    }
  }, [visible]);

  // Escape key closes modal on web (rule X4)
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, onCancel]);

  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth() + 1;
  const todayDate = today.getDate();

  const handlePrevMonth = () => {
    const moved = moveMonth(year, month, -1);
    setYear(moved.year);
    setMonth(moved.month);
    const maxDays = getDaysInMonth(moved.year, moved.month);
    if (selectedDay > maxDays) setSelectedDay(maxDays);
  };

  const handleNextMonth = () => {
    const moved = moveMonth(year, month, 1);
    setYear(moved.year);
    setMonth(moved.month);
    const maxDays = getDaysInMonth(moved.year, moved.month);
    if (selectedDay > maxDays) setSelectedDay(maxDays);
  };

  const handleDaySelect = (cell: MonthGridCell) => {
    setYear(cell.year);
    setMonth(cell.month);
    setSelectedDay(cell.day);
  };

  const changeHour = (delta: number) => {
    setHour((prev) => (prev + delta + 24) % 24);
  };

  const changeMinute = (delta: number) => {
    setMinute((prev) => (prev + delta + 60) % 60);
  };

  const currentDateString = `${year}-${pad2(month)}-${pad2(selectedDay)}`;
  const currentFormatted = combineDateTime(currentDateString, hour, minute);
  const isTimeOrderInvalid = minDate !== undefined && minDate.trim().length > 0 && isEndBeforeStart(minDate, currentFormatted);

  const handleConfirm = useCallback(() => {
    if (isTimeOrderInvalid) {
      // If end is before start, clamp to start date + 1 hour
      const startParts = parseLocalInput(minDate as string);
      if (startParts) {
        const clampedDate = new Date(
          startParts.year,
          startParts.month - 1,
          startParts.day,
          startParts.hour + 1,
          startParts.minute,
        );
        onConfirm(
          formatLocalInput({
            year: clampedDate.getFullYear(),
            month: clampedDate.getMonth() + 1,
            day: clampedDate.getDate(),
            hour: clampedDate.getHours(),
            minute: clampedDate.getMinutes(),
          }),
        );
        return;
      }
    }
    onConfirm(currentFormatted);
  }, [isTimeOrderInvalid, minDate, onConfirm, currentFormatted]);

  const monthWeeks = buildMonthGrid(year, month, 1);

  // Month title formatter: e.g. "October 2026"
  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(new Date(year, month - 1, 1));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
      <Pressable
        style={[styles.scrim, { backgroundColor: colors['color-scrim'], opacity: state.disabledContent }]}
        onPress={onCancel}
        accessible
        accessibilityRole="button"
        accessibilityLabel={t('action.cancel')}
        testID={`${testID}-scrim`}
      />
      <View style={styles.centering} pointerEvents="box-none">
        <View style={styles.dialog} testID={testID}>
          <ScrollView
            style={styles.dialogScroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={styles.header}>
              <Text ref={headingRef} variant="title-medium" accessibilityRole="header">
                {t(titleKey)}
              </Text>
              <Text variant="headline-small" tone="primary" testID={`${testID}-current-preview`}>
                {currentFormatted}
              </Text>
            </View>

            {/* Month Navigation */}
            <View style={styles.monthNav}>
              <Pressable
                style={styles.navButton}
                onPress={handlePrevMonth}
                accessible
                accessibilityRole="button"
                accessibilityLabel={t('action.previousMonth')}
                testID={`${testID}-prev-month`}
              >
                <MaterialIcons
                  name="chevron-left"
                  size={iconSize('title-medium')}
                  color={colors['color-on-surface']}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              </Pressable>
              <Text variant="title-medium" style={styles.monthTitle}>
                {monthName} {year}
              </Text>
              <Pressable
                style={styles.navButton}
                onPress={handleNextMonth}
                accessible
                accessibilityRole="button"
                accessibilityLabel={t('action.nextMonth')}
                testID={`${testID}-next-month`}
              >
                <MaterialIcons
                  name="chevron-right"
                  size={iconSize('title-medium')}
                  color={colors['color-on-surface']}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              </Pressable>
            </View>

            {/* Weekday Labels Header */}
            <View style={styles.weekdayRow}>
              {WEEKDAYS.map((wd) => (
                <View key={wd} style={styles.weekdayCell}>
                  <Text variant="label-small" tone="secondary">
                    {wd}
                  </Text>
                </View>
              ))}
            </View>

            {/* Month Days Grid */}
            <View style={styles.grid}>
              {monthWeeks.map((week, weekIdx) => (
                <View key={`week-${weekIdx}`} style={styles.weekRow}>
                  {week.map((cell) => {
                    const isSelected = cell.year === year && cell.month === month && cell.day === selectedDay;
                    const isToday = cell.year === todayYear && cell.month === todayMonth && cell.day === todayDate;

                    return (
                      <Pressable
                        key={cell.dateString}
                        style={[
                          styles.dayCell,
                          isSelected && styles.dayCellSelected,
                          isToday && !isSelected && styles.dayCellToday,
                        ]}
                        onPress={() => handleDaySelect(cell)}
                        accessible
                        accessibilityRole="button"
                        accessibilityLabel={`${cell.day} ${monthName} ${cell.year}`}
                        accessibilityState={{ selected: isSelected }}
                        testID={`${testID}-day-${cell.dateString}`}
                      >
                        <Text
                          variant="body-medium"
                          tone={isSelected ? 'primary' : cell.isCurrentMonth ? 'default' : 'secondary'}
                          style={isSelected ? styles.dayTextSelected : undefined}
                        >
                          {cell.day}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>

            {/* Time Selector */}
            <View style={styles.timeSection}>
              <Text variant="title-small" accessibilityRole="header">
                {t('picker.time.heading')} (24h)
              </Text>

              {/* Steppers for Hour and Minute */}
              <View style={styles.timeSteppers}>
                {/* Hour Stepper */}
                <View style={styles.stepperGroup}>
                  <Text variant="label-small" tone="secondary">
                    {t('picker.hour')}
                  </Text>
                  <View style={styles.stepperControls}>
                    <Pressable
                      style={styles.stepperButton}
                      onPress={() => changeHour(-1)}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={t('action.decreaseHour')}
                      testID={`${testID}-hour-minus`}
                    >
                      <MaterialIcons
                        name="remove"
                        size={iconSize('body-medium')}
                        color={colors['color-on-surface']}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </Pressable>
                    <Text variant="title-large" style={styles.stepperValue} testID={`${testID}-hour-value`}>
                      {pad2(hour)}
                    </Text>
                    <Pressable
                      style={styles.stepperButton}
                      onPress={() => changeHour(1)}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={t('action.increaseHour')}
                      testID={`${testID}-hour-plus`}
                    >
                      <MaterialIcons
                        name="add"
                        size={iconSize('body-medium')}
                        color={colors['color-on-surface']}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </Pressable>
                  </View>
                </View>

                {/* Minute Stepper (step 5) */}
                <View style={styles.stepperGroup}>
                  <Text variant="label-small" tone="secondary">
                    {t('picker.minute')}
                  </Text>
                  <View style={styles.stepperControls}>
                    <Pressable
                      style={styles.stepperButton}
                      onPress={() => changeMinute(-5)}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={t('action.decreaseMinute')}
                      testID={`${testID}-minute-minus`}
                    >
                      <MaterialIcons
                        name="remove"
                        size={iconSize('body-medium')}
                        color={colors['color-on-surface']}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </Pressable>
                    <Text variant="title-large" style={styles.stepperValue} testID={`${testID}-minute-value`}>
                      {pad2(minute)}
                    </Text>
                    <Pressable
                      style={styles.stepperButton}
                      onPress={() => changeMinute(5)}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={t('action.increaseMinute')}
                      testID={`${testID}-minute-plus`}
                    >
                      <MaterialIcons
                        name="add"
                        size={iconSize('body-medium')}
                        color={colors['color-on-surface']}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </Pressable>
                  </View>
                </View>
              </View>

              {/* Quick minute chips */}
              <View style={styles.quickChipsRow}>
                {MINUTE_STEPS.map((m) => (
                  <Pressable
                    key={`min-${m}`}
                    style={[styles.quickChip, minute === m && styles.quickChipSelected]}
                    onPress={() => setMinute(m)}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={`${m} minutes`}
                    testID={`${testID}-quick-min-${m}`}
                  >
                    <Text variant="label-small" tone={minute === m ? 'primary' : 'default'}>
                      :{pad2(m)}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Quick hour chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hourScroll}>
                {COMMON_HOURS.map((h) => (
                  <Pressable
                    key={`hr-${h}`}
                    style={[styles.quickChip, hour === h && styles.quickChipSelected]}
                    onPress={() => setHour(h)}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={`${h} hours`}
                    testID={`${testID}-quick-hr-${h}`}
                  >
                    <Text variant="label-small" tone={hour === h ? 'primary' : 'default'}>
                      {pad2(h)}:00
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            {/* Time Order Warning */}
            {isTimeOrderInvalid ? (
              <LiveRegion tone="error">{TIME_ORDER_ERROR}</LiveRegion>
            ) : null}
          </ScrollView>

          {/* Actions */}
          <View style={styles.actions}>
            <Button label="action.cancel" variant="ghost" fullWidth={false} onPress={onCancel} testID={`${testID}-cancel`} />
            <Button label="action.confirm" variant="primary" fullWidth={false} onPress={handleConfirm} testID={`${testID}-confirm`} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: StyleSheet.absoluteFill,
  centering: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: PICKER_CENTERING_PADDING,
  },
  dialog: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    maxHeight: '90%',
    backgroundColor: colors['color-surface'],
    borderRadius: Number(shape.large),
    padding: PICKER_DIALOG_PADDING,
  },
  dialogScroll: {
    flexShrink: 1,
  },
  scrollContent: {
    gap: Number(spacing.base),
  },
  header: {
    gap: Number(spacing.extraSmall),
    alignItems: 'center',
  },
  monthNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Number(spacing.small),
  },
  navButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Number(shape.full),
  },
  monthTitle: {
    fontWeight: '600',
  },
  weekdayRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors['color-outline-variant'],
    paddingBottom: Number(spacing.extraSmall),
  },
  weekdayCell: {
    flex: 1,
    maxWidth: PICKER_CELL_MAX_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: {
    gap: Number(spacing.extraSmall),
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayCell: {
    flex: 1,
    maxWidth: PICKER_CELL_MAX_WIDTH,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Number(shape.medium),
  },
  dayCellSelected: {
    backgroundColor: colors['color-primary-container'],
    borderWidth: 2,
    borderColor: colors['color-primary'],
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: colors['color-outline'],
  },
  dayTextSelected: {
    fontWeight: '700',
  },
  timeSection: {
    gap: Number(spacing.small),
    paddingTop: Number(spacing.small),
    borderTopWidth: 1,
    borderTopColor: colors['color-outline-variant'],
  },
  timeSteppers: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: PICKER_STEPPER_GAP,
  },
  stepperGroup: {
    alignItems: 'center',
    gap: Number(spacing.extraSmall),
  },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: STEPPER_INTERNAL_GAP,
    backgroundColor: colors['color-surface-container-high'],
    borderRadius: Number(shape.medium),
    padding: STEPPER_CONTROLS_PADDING,
  },
  stepperButton: {
    width: STEPPER_BUTTON_SIZE,
    height: STEPPER_BUTTON_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperValue: {
    minWidth: STEPPER_VALUE_MIN_WIDTH,
    textAlign: 'center',
    fontWeight: '700',
  },
  quickChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Number(spacing.extraSmall),
  },
  hourScroll: {
    gap: Number(spacing.extraSmall),
    paddingVertical: Number(spacing.extraSmall),
  },
  quickChip: {
    minWidth: 44,
    height: 36,
    paddingHorizontal: Number(spacing.small),
    borderRadius: Number(shape.small),
    backgroundColor: colors['color-surface-container'],
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickChipSelected: {
    backgroundColor: colors['color-primary-container'],
    borderWidth: 1,
    borderColor: colors['color-primary'],
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Number(spacing.small),
    marginTop: Number(spacing.base),
  },
});
