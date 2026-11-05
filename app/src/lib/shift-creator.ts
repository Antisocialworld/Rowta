// shift-creator.ts — pure shift creator formatting helpers (PRD 8.3, 8.4; Owner Decision D9).
import { t, type MessageKey } from '../i18n/en';

const ROLE_LABEL: Record<string, MessageKey> = {
  owner: 'role.owner',
  manager: 'role.manager',
  staff: 'role.staff',
};

export interface ShiftCreatorData {
  displayName: string;
  role?: string | null;
}

/**
 * Formats "Created by {name} ({role})" (Owner Decision D9).
 * Name only, never email. If creator is no longer a member (role is null/undefined), shows name only.
 */
export function formatShiftCreator(creator: ShiftCreatorData | null | undefined): string {
  if (!creator || !creator.displayName.trim()) return '';
  const name = creator.displayName.trim();
  const roleKey = creator.role ? ROLE_LABEL[creator.role] : undefined;
  if (roleKey) {
    const roleText = t(roleKey);
    return t('shift.detail.createdByWithRole', { name, role: roleText });
  }
  return t('shift.detail.createdBy', { name });
}
