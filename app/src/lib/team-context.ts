// team-context.ts — pure team-name display helper for the Dashboard identity row (PRD 6.1).
import { t } from '../i18n/en';

const WHOLE_WORD_TEAM = /\bteam\b/i;

export function teamContextLabel(name: string): string {
  return WHOLE_WORD_TEAM.test(name) ? name : t('team.contextLabel', { name });
}
