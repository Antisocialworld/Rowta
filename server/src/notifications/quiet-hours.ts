// Pure quiet-hours engine for notification delivery (PRD 8.7, 8.8, 8.11; rules C9, J4).
// Computes "now" in the user's IANA time zone using built-in Intl APIs with zero I/O and zero clock reads.
// Handles midnight-crossing windows, day boundaries, and Daylight Saving Time (gaps and overlaps).

export class InvalidTimeZoneError extends Error {
  constructor(timeZone: string) {
    super(`Invalid IANA time zone: ${timeZone}`);
    this.name = 'InvalidTimeZoneError';
  }
}

export type DeliveryDecision =
  | { action: 'send' }
  | { action: 'delay'; deliverAt: Date; delayMs: number };

export interface DecideDeliveryParams {
  now: Date;
  timeZone: string;
  quietStart: string | null;
  quietEnd: string | null;
  urgent: boolean;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Validates whether an IANA time zone identifier is supported by the Intl runtime.
 */
export function isValidTimeZone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.trim() === '') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses 'HH:MM' or 'HH:MM:SS' time strings.
 * Returns integer minutes after local midnight (0 to 1439), or null if malformed.
 */
export function parseQuietTime(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] !== undefined ? Number(match[3]) : 0;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(date);
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const part of parts) {
    switch (part.type) {
      case 'year':
        year = Number(part.value);
        break;
      case 'month':
        month = Number(part.value);
        break;
      case 'day':
        day = Number(part.value);
        break;
      case 'hour':
        hour = Number(part.value);
        break;
      case 'minute':
        minute = Number(part.value);
        break;
      case 'second':
        second = Number(part.value);
        break;
    }
  }
  if (hour === 24) hour = 0;
  return { year, month, day, hour, minute, second };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const zp = getZonedParts(date, timeZone);
  const localAsUtc = Date.UTC(zp.year, zp.month - 1, zp.day, zp.hour, zp.minute, zp.second);
  return localAsUtc - date.getTime();
}

function getLocalAsUtcMs(date: Date, timeZone: string): number {
  const zp = getZonedParts(date, timeZone);
  return (
    Date.UTC(zp.year, zp.month - 1, zp.day, zp.hour, zp.minute, zp.second) +
    date.getUTCMilliseconds()
  );
}

function findNextDeliverAt(
  now: Date,
  timeZone: string,
  endMinutes: number,
  targetYear: number,
  targetMonth: number,
  targetDay: number,
  depth = 0,
): Date {
  if (depth > 2) {
    return new Date(now.getTime() + 24 * 3600 * 1000);
  }

  const targetHour = Math.floor(endMinutes / 60);
  const targetMinute = endMinutes % 60;
  const targetLocalAsUtc = Date.UTC(targetYear, targetMonth - 1, targetDay, targetHour, targetMinute, 0, 0);

  const sampleOffsets = new Set<number>();
  for (let h = -36; h <= 36; h += 3) {
    const d = new Date(targetLocalAsUtc + h * 3600000);
    sampleOffsets.add(getTimeZoneOffsetMs(d, timeZone));
  }

  const matchingInstants: Date[] = [];
  for (const offset of sampleOffsets) {
    const candidate = new Date(targetLocalAsUtc - offset);
    const zp = getZonedParts(candidate, timeZone);
    if (
      zp.year === targetYear &&
      zp.month === targetMonth &&
      zp.day === targetDay &&
      zp.hour === targetHour &&
      zp.minute === targetMinute &&
      zp.second === 0
    ) {
      if (!matchingInstants.some((m) => m.getTime() === candidate.getTime())) {
        matchingInstants.push(candidate);
      }
    }
  }

  matchingInstants.sort((a, b) => a.getTime() - b.getTime());
  const futureMatch = matchingInstants.find((d) => d.getTime() > now.getTime());
  if (futureMatch) {
    return futureMatch;
  }

  // If no matching instant exists at all on that day, it falls in a spring-forward gap.
  if (matchingInstants.length === 0) {
    const offsetArray = Array.from(sampleOffsets);
    const minOffset = Math.min(...offsetArray);
    const maxOffset = Math.max(...offsetArray);
    let low = targetLocalAsUtc - maxOffset - 3600000;
    let high = targetLocalAsUtc - minOffset + 3600000;
    let ans = high;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midLocal = getLocalAsUtcMs(new Date(mid), timeZone);
      if (midLocal >= targetLocalAsUtc) {
        ans = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    const gapEndInstant = new Date(ans);
    if (gapEndInstant.getTime() > now.getTime()) {
      return gapEndInstant;
    }
  }

  // Advance to next local calendar day if match or gap was in the past
  const nextDate = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay + 1));
  return findNextDeliverAt(
    now,
    timeZone,
    endMinutes,
    nextDate.getUTCFullYear(),
    nextDate.getUTCMonth() + 1,
    nextDate.getUTCDate(),
    depth + 1,
  );
}

/**
 * Pure quiet-hours decision engine.
 * Given an evaluation instant and user settings, determines whether to send immediately
 * or delay until the user's local wall-clock reaches quiet_end.
 */
export function decideDelivery(params: DecideDeliveryParams): DeliveryDecision {
  const { now, timeZone, quietStart, quietEnd, urgent } = params;

  if (!isValidTimeZone(timeZone)) {
    throw new InvalidTimeZoneError(timeZone);
  }

  // Rule 3a: Urgent notifications bypass quiet hours and send immediately.
  if (urgent) {
    return { action: 'send' };
  }

  // Rule 3a: Either quiet value null means quiet hours are disabled.
  if (quietStart === null || quietEnd === null) {
    return { action: 'send' };
  }

  const startMinutes = parseQuietTime(quietStart);
  const endMinutes = parseQuietTime(quietEnd);

  // Malformed time values fall back safely to send.
  if (startMinutes === null || endMinutes === null) {
    return { action: 'send' };
  }

  // Rule 3b [DECISION]: quietStart equals quietEnd represents an empty (zero-length) quiet window; send immediately.
  if (startMinutes === endMinutes) {
    return { action: 'send' };
  }

  const nowParts = getZonedParts(now, timeZone);
  const nowMsAfterMidnight =
    ((nowParts.hour * 60 + nowParts.minute) * 60 + nowParts.second) * 1000 +
    now.getUTCMilliseconds();

  const startMs = startMinutes * 60 * 1000;
  const endMs = endMinutes * 60 * 1000;

  const isInQuietWindow =
    startMinutes < endMinutes
      ? nowMsAfterMidnight >= startMs && nowMsAfterMidnight < endMs
      : nowMsAfterMidnight >= startMs || nowMsAfterMidnight < endMs;

  if (!isInQuietWindow) {
    return { action: 'send' };
  }

  // Find the target calendar day for quiet_end
  let targetYear = nowParts.year;
  let targetMonth = nowParts.month;
  let targetDay = nowParts.day;

  if (startMinutes > endMinutes && nowMsAfterMidnight >= startMs) {
    // Window started today and crosses into tomorrow
    const nextDate = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + 1));
    targetYear = nextDate.getUTCFullYear();
    targetMonth = nextDate.getUTCMonth() + 1;
    targetDay = nextDate.getUTCDate();
  }

  const deliverAt = findNextDeliverAt(now, timeZone, endMinutes, targetYear, targetMonth, targetDay);
  const delayMs = deliverAt.getTime() - now.getTime();

  return {
    action: 'delay',
    deliverAt,
    delayMs,
  };
}

