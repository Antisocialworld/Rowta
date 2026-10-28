// ACTIVITY FEED PAGING (Phase 4; PRD 8.3; rules U2, U6).
//
// Two pure pieces keep fast scrolling from firing duplicate requests AND keep duplicate rows out of
// the list even if a page arrives twice:
//   * mergeActivityPages flattens TanStack Query's pages and de-duplicates by event id, preserving
//     server order (newest first).
//   * createPagingGate lets exactly one "load more" request run at a time; repeated onEndReached
//     callbacks while the first request is in flight are ignored. Scripts/test-shift-logic.ts proves
//     ten rapid calls produce one request.
import type { ActivityEventPayload } from '@rowta/shared';

export function mergeActivityPages(pages: readonly (readonly ActivityEventPayload[])[]): ActivityEventPayload[] {
  const seen = new Set<string>();
  const merged: ActivityEventPayload[] = [];
  for (const page of pages) {
    for (const event of page) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      merged.push(event);
    }
  }
  return merged;
}

export type PagingGate = {
  /** Runs `request` unless a previous call is still in flight. Never rejects. */
  request: () => Promise<void>;
  isBusy: () => boolean;
};

export function createPagingGate(request: () => Promise<unknown>): PagingGate {
  let busy = false;
  return {
    async request() {
      if (busy) return;
      busy = true;
      try {
        await request();
      } catch {
        // The query layer surfaces and retries its own errors; the gate only serialises calls.
      } finally {
        busy = false;
      }
    },
    isBusy: () => busy,
  };
}

/** True only when a next page exists, nothing is in flight, and the caller is allowed to ask. */
export function canRequestNextPage(state: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isBusy: boolean;
}): boolean {
  return state.hasNextPage && !state.isFetchingNextPage && !state.isBusy;
}
