// SUBMIT STATE for every auth form (rules V5, X3, X14g, S14i): ONE hook owns busy, the form-level
// error line, per-field error keys and the 429 countdown, so all ten views behave identically.
//
// - busy: the Button shows a spinner, ignores repeat taps (X14g).
// - formError: a MessageKey for the view's polite LiveRegion — never raw text (V5). A 422 with
//   per-field codes sets NO form error: the fields speak for themselves under their inputs (X3).
// - fieldError(name): the server's per-field catalog code, safe-mapped (unknown -> generic.error).
// - retryIn: after a 429, the countdown in SECONDS from the Retry-After header (S14i), ticking
//   visually only — the announcement is the single fixed auth.rateLimited line (never per-second
//   spam). Ticks to 0 and hides.
// - submit(): runs the request, maps ApiError -> codes, anything else (a client-side schema throw,
//   an unexpected bug) -> generic.error so raw messages can never reach a screen (V5).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, errorTextKey } from '../lib/api';
import { isMessageKey, type MessageKey } from '../i18n/en';

export type AuthForm = {
  busy: boolean;
  formError: MessageKey | null;
  /** Server 429 countdown in remaining seconds, or null (line hidden at 0 / no limit hit). */
  retryIn: number | null;
  fieldError: (name: string) => MessageKey | undefined;
  /** Runs `request`; returns its result or null after mapping the failure to catalog keys. */
  submit: <T>(request: () => Promise<T>) => Promise<T | null>;
};

export function useAuthForm(): AuthForm {
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [retryIn, setRetryIn] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (countdownRef.current !== null) clearInterval(countdownRef.current);
    };
  }, []);

  const startRetryCountdown = useCallback((seconds: number) => {
    if (countdownRef.current !== null) clearInterval(countdownRef.current);
    setRetryIn(seconds);
    countdownRef.current = setInterval(() => {
      setRetryIn((current) => {
        if (current === null || current <= 1) {
          if (countdownRef.current !== null) clearInterval(countdownRef.current);
          countdownRef.current = null;
          return null;
        }
        return current - 1;
      });
    }, 1000);
  }, []);

  const submit = useCallback(
    async <T,>(request: () => Promise<T>): Promise<T | null> => {
      setBusy(true);
      setFormError(null);
      setFields({});
      try {
        return await request();
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 429) {
            setFormError('auth.rateLimited');
            if (error.retryAfterSeconds !== undefined && error.retryAfterSeconds > 0) {
              startRetryCountdown(error.retryAfterSeconds);
            }
          } else if (error.fields !== undefined && Object.keys(error.fields).length > 0) {
            setFields(error.fields);
          } else {
            setFormError(errorTextKey(error));
          }
        } else {
          // A client-side schema rejection or an unexpected throw: never the raw message (V5).
          setFormError('generic.error');
        }
        return null;
      } finally {
        setBusy(false);
      }
    },
    [startRetryCountdown],
  );

  const fieldError = useCallback((name: string): MessageKey | undefined => {
    const code = fields[name];
    if (code === undefined) return undefined;
    return isMessageKey(code) ? code : 'generic.error';
  }, []);

  return { busy, formError, retryIn, fieldError, submit };
}
