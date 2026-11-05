// Pure helper for CreateTeam idempotency-key discipline (ADR 0012, Phase 3; rules V1, S5).
// Governs when an idempotency key and the team name it was generated for are kept or cleared.
// Contains NO React or React Native dependencies (testable in plain Node without Flow parser issues).

import { ApiError } from './api';

export type CreateTeamOutcome =
  | 'success'
  | '4xx'
  | 'network_error'
  | 'timeout'
  | '5xx'
  | 'in_flight';

/**
 * Returns true if an error represents an indeterminate result:
 * - Network error (ApiError status 0 or code 'client.network', TypeError fetch failure)
 * - Timeout (ApiError code 'client.timeout' or status 408)
 * - In-flight collision (ApiError status 409 and code 'idempotency.in_flight')
 * - 5xx server error (ApiError status 500-599)
 */
export function isIndeterminateError(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.code === 'client.network' || error.status === 0) return true;
    if (error.code === 'client.timeout' || error.status === 408) return true;
    if (error.status === 409 && error.code === 'idempotency.in_flight') return true;
    if (error.status >= 500 && error.status <= 599) return true;
    return false;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    const name = error.name.toLowerCase();
    if (name === 'typeerror' || msg.includes('network') || msg.includes('timeout') || msg.includes('abort')) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if an error is a definitive 4xx validation or client error
 * (e.g. 422 name taken, 400 bad request, 403 forbidden, 409 non-in_flight).
 * 408 (timeout), 429 (rate limit), and 409 'idempotency.in_flight' are excluded from definitive rejection.
 */
export function isDefinitive4xxError(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.code === 'idempotency.in_flight') {
      return false;
    }
    if (error.status >= 400 && error.status <= 499 && error.status !== 408 && error.status !== 429) {
      return true;
    }
  }
  return false;
}

/**
 * Classify a submission outcome or caught error into a CreateTeamOutcome.
 */
export function classifyCreateTeamOutcome(result: 'success' | unknown): CreateTeamOutcome {
  if (result === 'success') return 'success';
  if (result instanceof ApiError) {
    if (result.status === 409 && result.code === 'idempotency.in_flight') return 'in_flight';
    if (result.code === 'client.timeout' || result.status === 408) return 'timeout';
    if (result.code === 'client.network' || result.status === 0) return 'network_error';
    if (result.status >= 500 && result.status <= 599) return '5xx';
    if (result.status >= 400 && result.status <= 499) return '4xx';
  }
  if (isIndeterminateError(result)) {
    if (result instanceof Error && result.message.toLowerCase().includes('timeout')) {
      return 'timeout';
    }
    return 'network_error';
  }
  return '4xx';
}

/**
 * Returns true if the key and name should be cleared immediately upon receiving this outcome.
 * Clears on:
 * - 'success'
 * - '4xx' (definitive client/validation error)
 * Retains key on indeterminate outcomes:
 * - 'network_error'
 * - 'timeout'
 * - '5xx'
 * - 'in_flight'
 */
export function shouldClearOnOutcome(outcome: CreateTeamOutcome): boolean {
  return outcome === 'success' || outcome === '4xx';
}

/**
 * Returns true if closing the modal should clear the stored key and name.
 * If the last attempt ended in an indeterminate result ('network_error', 'timeout', '5xx', 'in_flight'),
 * closing the modal retains the key and name so reopening with the same name reuses it.
 * Otherwise (success, 4xx, or no attempt made), closing clears the key.
 */
export function shouldClearOnModalClose(lastOutcome: CreateTeamOutcome | null): boolean {
  if (
    lastOutcome === 'network_error' ||
    lastOutcome === 'timeout' ||
    lastOutcome === '5xx' ||
    lastOutcome === 'in_flight'
  ) {
    return false;
  }
  return true;
}

/**
 * Decides whether an existing key should be reused for a new or current team name.
 * Reuses ONLY when:
 * 1. An existing key is present.
 * 2. An existing name was recorded.
 * 3. The candidate name (trimmed) matches the existing name (trimmed).
 * If the candidate name differs or is empty, returns false (must clear and regenerate).
 */
export function canReuseCreateKey(
  existingKey: string | null,
  existingName: string | null,
  candidateName: string,
): boolean {
  if (!existingKey || !existingName) return false;
  const trimmed = candidateName.trim();
  if (trimmed.length === 0) return false;
  return existingName.trim() === trimmed;
}

/**
 * Returns whether changing the name from `keyName` to `newName` requires clearing
 * the idempotency key.
 */
export function shouldClearOnNameChange(
  keyName: string | null,
  newName: string,
): boolean {
  if (!keyName) return false;
  return keyName.trim() !== newName.trim();
}

/**
 * Session coordinator for create-team idempotency lifecycle.
 * Encapsulates the complete state transitions for submit attempts, retries,
 * indeterminate failures, name changes, and modal close/reopen.
 */
export class CreateTeamIdempotencySession {
  private key: string | null = null;
  private name: string | null = null;
  private lastOutcome: CreateTeamOutcome | null = null;

  constructor(initial?: { key?: string | null; name?: string | null; lastOutcome?: CreateTeamOutcome | null }) {
    this.key = initial?.key ?? null;
    this.name = initial?.name ?? null;
    this.lastOutcome = initial?.lastOutcome ?? null;
  }

  getKey(): string | null {
    return this.key;
  }

  getName(): string | null {
    return this.name;
  }

  getLastOutcome(): CreateTeamOutcome | null {
    return this.lastOutcome;
  }

  ensureKey(candidateName: string, keyGenerator: () => string): string {
    const trimmed = candidateName.trim();
    if (this.key && canReuseCreateKey(this.key, this.name, trimmed)) {
      return this.key;
    }
    this.key = keyGenerator();
    this.name = trimmed;
    this.lastOutcome = null;
    return this.key;
  }

  onNameChange(newName: string): boolean {
    if (shouldClearOnNameChange(this.name, newName)) {
      this.clear();
      return true;
    }
    return false;
  }

  recordOutcome(result: 'success' | unknown): CreateTeamOutcome {
    const outcome = classifyCreateTeamOutcome(result);
    this.lastOutcome = outcome;
    if (shouldClearOnOutcome(outcome)) {
      this.clear();
    }
    return outcome;
  }

  onModalClose(): boolean {
    if (shouldClearOnModalClose(this.lastOutcome)) {
      this.clear();
      return true;
    }
    return false;
  }

  clear(): void {
    this.key = null;
    this.name = null;
    this.lastOutcome = null;
  }
}

