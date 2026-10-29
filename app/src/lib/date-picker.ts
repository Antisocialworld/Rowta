// DATE & TIME PICKER MATHS AND HELPERS (Phase 4; rules U7, U8, V1, X6).
//
// Pure calendar mathematics with zero external date library dependencies.
// All date and time calculations operate on device local wall-clock time.
//
// Features:
// - Days in month calculation with leap year support (Gregorian calendar rules)
// - Month grid generation with configurable week start day (default Monday, ISO 8601)
// - Month navigation (moving forwards and backwards across year boundaries)
// - Start-to-end clamping (ensures shift end is never before shift start)
// - Pure round-trip parsing and formatting compatible with shift-time.ts

export interface MonthGridCell {
  year: number;
  month: number;
  day: number;
  isCurrentMonth: boolean;
  dateString: string; // 'YYYY-MM-DD'
}

export interface LocalTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const LOCAL_FORMAT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Determines if a Gregorian year is a leap year. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Returns the number of days in the given month (month: 1-12). */
export function getDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }
  return 31;
}

/** Formats date parts into 'YYYY-MM-DD'. */
export function formatDateString(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Moves a (year, month) pair by delta months (+1, -1, etc.).
 * Month is 1-indexed (1 = January, 12 = December).
 */
export function moveMonth(year: number, month: number, delta: number): { year: number; month: number } {
  let newMonth = month + delta;
  let newYear = year;
  while (newMonth > 12) {
    newMonth -= 12;
    newYear += 1;
  }
  while (newMonth < 1) {
    newMonth += 12;
    newYear -= 1;
  }
  return { year: newYear, month: newMonth };
}

/**
 * Builds a month grid array of weeks (each week has 7 cells).
 * weekStart: 1 = Monday (default, ISO 8601), 0 = Sunday.
 */
export function buildMonthGrid(year: number, month: number, weekStart = 1): MonthGridCell[][] {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat

  // Offset from week start to first day of month
  const leadingDays = weekStart === 1 ? (firstDayOfWeek + 6) % 7 : firstDayOfWeek;

  const prevMonthInfo = moveMonth(year, month, -1);
  const prevMonthDays = getDaysInMonth(prevMonthInfo.year, prevMonthInfo.month);

  const cells: MonthGridCell[] = [];

  // 1. Leading days from previous month
  for (let i = leadingDays - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    cells.push({
      year: prevMonthInfo.year,
      month: prevMonthInfo.month,
      day,
      isCurrentMonth: false,
      dateString: formatDateString(prevMonthInfo.year, prevMonthInfo.month, day),
    });
  }

  // 2. Days in current month
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({
      year,
      month,
      day,
      isCurrentMonth: true,
      dateString: formatDateString(year, month, day),
    });
  }

  // 3. Trailing days from next month to complete the week rows
  const nextMonthInfo = moveMonth(year, month, 1);
  let nextDay = 1;
  while (cells.length % 7 !== 0 || cells.length < 35) {
    cells.push({
      year: nextMonthInfo.year,
      month: nextMonthInfo.month,
      day: nextDay,
      isCurrentMonth: false,
      dateString: formatDateString(nextMonthInfo.year, nextMonthInfo.month, nextDay),
    });
    nextDay++;
  }

  // Split into weeks of 7 days
  const weeks: MonthGridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

/** Combines a date string ('YYYY-MM-DD') and hour + minute into 'YYYY-MM-DD HH:MM'. */
export function combineDateTime(dateString: string, hour: number, minute: number): string {
  return `${dateString.trim()} ${pad2(hour)}:${pad2(minute)}`;
}

/** Parses 'YYYY-MM-DD HH:MM' into its local time parts, or null if invalid. */
export function parseLocalInput(value: string): LocalTimeParts | null {
  const match = LOCAL_FORMAT.exec(value.trim());
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > getDaysInMonth(year, month)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return { year, month, day, hour, minute };
}

/** Formats local time parts into 'YYYY-MM-DD HH:MM'. */
export function formatLocalInput(parts: LocalTimeParts): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/**
 * Checks if the end datetime string is before or equal to the start datetime string.
 * Returns true if end is invalid or before/equal start.
 */
export function isEndBeforeStart(startStr: string, endStr: string): boolean {
  const startParts = parseLocalInput(startStr);
  const endParts = parseLocalInput(endStr);
  if (!startParts || !endParts) return false;

  const startDate = new Date(
    startParts.year,
    startParts.month - 1,
    startParts.day,
    startParts.hour,
    startParts.minute,
  );
  const endDate = new Date(
    endParts.year,
    endParts.month - 1,
    endParts.day,
    endParts.hour,
    endParts.minute,
  );
  return endDate.getTime() <= startDate.getTime();
}

/**
 * Clamps end date/time relative to start date/time.
 * - If endStr is empty, sets end to start + 8 hours (on the same day if it fits, otherwise clamps to same day 23:59).
 * - If endStr is before startStr, clamps endStr to startStr + 1 hour (same day or clamped).
 */
export function clampEndToStart(startStr: string, endStr: string, defaultDurationHours = 8): string {
  const startParts = parseLocalInput(startStr);
  if (!startParts) return endStr;

  const endParts = parseLocalInput(endStr);

  if (!endParts) {
    // If end is empty, set to start + 8 hours on the same day; clamp to 23:59 if exceeding midnight
    const targetHour = startParts.hour + defaultDurationHours;
    if (targetHour < 24) {
      return formatLocalInput({
        year: startParts.year,
        month: startParts.month,
        day: startParts.day,
        hour: targetHour,
        minute: startParts.minute,
      });
    }
    return formatLocalInput({
      year: startParts.year,
      month: startParts.month,
      day: startParts.day,
      hour: 23,
      minute: 59,
    });
  }

  const startDate = new Date(
    startParts.year,
    startParts.month - 1,
    startParts.day,
    startParts.hour,
    startParts.minute,
  );
  const endDate = new Date(
    endParts.year,
    endParts.month - 1,
    endParts.day,
    endParts.hour,
    endParts.minute,
  );

  if (endDate.getTime() <= startDate.getTime()) {
    // Clamp to start date + 1 hour, staying on the same day if possible
    const targetHour = startParts.hour + 1;
    if (targetHour < 24) {
      return formatLocalInput({
        year: startParts.year,
        month: startParts.month,
        day: startParts.day,
        hour: targetHour,
        minute: startParts.minute,
      });
    }
    return formatLocalInput({
      year: startParts.year,
      month: startParts.month,
      day: startParts.day,
      hour: 23,
      minute: 59,
    });
  }

  return endStr;
}

