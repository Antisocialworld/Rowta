// Pure helper for real-time search debouncing and query validation (rules U1, U7, X14; PRD 8.4).
import { SEARCH_QUERY_MIN_LENGTH } from '@rowta/shared';

export const SEARCH_DEBOUNCE_MS = 300;

export type SearchDecision =
  | { type: 'empty' }
  | { type: 'no_change' }
  | { type: 'search'; query: string };

/**
 * Pure evaluation of a search query:
 * - Trims input.
 * - < SEARCH_QUERY_MIN_LENGTH (2 characters): 'empty' (no request, no error flashed).
 * - Identical trimmed query: 'no_change' (no duplicate request).
 * - >= SEARCH_QUERY_MIN_LENGTH new query: 'search' with trimmed query string.
 */
export function evaluateSearchQuery(
  raw: string,
  currentQuery: string | null,
  minLength: number = SEARCH_QUERY_MIN_LENGTH,
): SearchDecision {
  const trimmed = raw.trim();
  if (trimmed.length < minLength) {
    return { type: 'empty' };
  }
  if (trimmed === currentQuery) {
    return { type: 'no_change' };
  }
  return { type: 'search', query: trimmed };
}

/**
 * Pure determination of visible search results:
 * When lastQuery is null or shorter than minLength (empty, single char, whitespace),
 * no results or section headings may render (returns null).
 * When lastQuery is an active valid query, returns the loaded/cached data (or null if undefined/null).
 */
export function getVisibleSearchResults<T>(
  lastQuery: string | null,
  data: T | undefined | null,
  minLength: number = SEARCH_QUERY_MIN_LENGTH,
): T | null {
  if (lastQuery === null || lastQuery.trim().length < minLength) {
    return null;
  }
  return data ?? null;
}

export type TimerImplementation<T = unknown> = {
  setTimeout: (fn: () => void, ms: number) => T;
  clearTimeout: (id: T) => void;
};

const defaultTimerImpl: TimerImplementation<ReturnType<typeof setTimeout>> = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

/**
 * Creates a pure debounced runner.
 * Allows cancelling, flushing immediately (e.g. Enter key), and testing with custom timers.
 */
export function createDebouncedRunner<T = ReturnType<typeof setTimeout>>(
  delayMs: number = SEARCH_DEBOUNCE_MS,
  timerImpl: TimerImplementation<T> = defaultTimerImpl as unknown as TimerImplementation<T>,
) {
  let timerId: T | null = null;
  let pendingFn: (() => void) | null = null;

  return {
    run(fn: () => void, immediate: boolean = false) {
      if (timerId !== null) {
        timerImpl.clearTimeout(timerId);
        timerId = null;
      }
      if (immediate) {
        pendingFn = null;
        fn();
        return;
      }
      pendingFn = fn;
      timerId = timerImpl.setTimeout(() => {
        timerId = null;
        const toRun = pendingFn;
        pendingFn = null;
        toRun?.();
      }, delayMs);
    },
    flush() {
      if (timerId !== null) {
        timerImpl.clearTimeout(timerId);
        timerId = null;
        const toRun = pendingFn;
        pendingFn = null;
        toRun?.();
      }
    },
    cancel() {
      if (timerId !== null) {
        timerImpl.clearTimeout(timerId);
        timerId = null;
      }
      pendingFn = null;
    },
    get isPending(): boolean {
      return timerId !== null;
    },
  };
}
