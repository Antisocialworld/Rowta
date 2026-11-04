// dashboard-greeting.ts — pure time-of-day greeting helper for the Dashboard (PRD 6.1).
import type { MessageKey } from '../i18n/en';

export function greetingKeyForHour(hour: number): MessageKey {
  if (hour >= 5 && hour <= 11) return 'dashboard.greeting.morning';
  if (hour >= 12 && hour <= 16) return 'dashboard.greeting.afternoon';
  return 'dashboard.greeting.evening';
}
