// COUNTDOWN (rule A9): a ticking line driven by the SERVER's remaining seconds, never by a clock
// time computed on the phone. `useCountdown(total, restartKey)` starts at total, ticks down once a
// second to 0 and stays there (0 = "the wait is over"); changing total OR bumping restartKey (a
// resend returned the SAME 60 seconds again) restarts the wait. `formatClock` renders M:SS for the
// {time} placeholder of auth.code.resendIn.
import { useEffect, useState } from 'react';
import { t } from '../i18n/en';

export function useCountdown(initialSeconds: number | null, restartKey?: unknown): number | null {
  const [remaining, setRemaining] = useState<number | null>(initialSeconds);

  useEffect(() => {
    setRemaining(initialSeconds);
    if (initialSeconds === null || initialSeconds <= 0) return;
    const timer = setInterval(() => {
      setRemaining((current) => (current === null || current <= 1 ? 0 : current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [initialSeconds, restartKey]);

  return remaining;
}

export function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}


/**
 * Formats remaining seconds into a human-readable duration wait string using catalog strings:
 * - 0 or negative: null (must not show a countdown)
 * - Under 60 seconds: "N seconds" (singular: "1 second", plural: "{count} seconds")
 * - Under 1 hour (60 to 3599 seconds): "N minutes" (round UP; 60 -> "1 minute", 61 -> "2 minutes", 3599 -> "60 minutes")
 * - Otherwise (>= 3600 seconds): "N hours" (round UP; 3600 -> "1 hour", 3601 -> "2 hours", 7200 -> "2 hours")
 */
export function formatRetryWait(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || seconds <= 0) return null;
  if (seconds < 60) {
    return seconds === 1
      ? t('auth.rateLimit.wait.second')
      : t('auth.rateLimit.wait.seconds', { count: seconds });
  }
  if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60);
    return minutes === 1
      ? t('auth.rateLimit.wait.minute')
      : t('auth.rateLimit.wait.minutes', { count: minutes });
  }
  const hours = Math.ceil(seconds / 3600);
  return hours === 1
    ? t('auth.rateLimit.wait.hour')
    : t('auth.rateLimit.wait.hours', { count: hours });
}

/**
 * Formats the full live countdown line (e.g. "Try again in 59 seconds.") or null if seconds <= 0.
 */
export function formatRetryIn(seconds: number | null | undefined): string | null {
  const wait = formatRetryWait(seconds);
  if (wait === null) return null;
  return t('auth.rateLimit.retryIn', { wait });
}

