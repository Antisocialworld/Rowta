// COUNTDOWN (rule A9): a ticking line driven by the SERVER's remaining seconds, never by a clock
// time computed on the phone. `useCountdown(total, restartKey)` starts at total, ticks down once a
// second to 0 and stays there (0 = "the wait is over"); changing total OR bumping restartKey (a
// resend returned the SAME 60 seconds again) restarts the wait. `formatClock` renders M:SS for the
// {time} placeholder of auth.code.resendIn.
import { useEffect, useState } from 'react';

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
