// FAKE DATA for the component gallery only (Phase 1 step 4). These strings never reach a screen the user
// signs in to: the gallery is reachable from the signed-in Phase 1 branch, which itself refuses a release
// build (docs/SECURITY.md section 3). Phase 2 replaces all of it with server data (S5).
import type { ShiftCardData } from '../components/ShiftCard';

export const GALLERY_SHIFTS: { card: ShiftCardData; badge: { label: 'gallery.badge.upcoming' | 'gallery.badge.open'; tone: 'primary' | 'warning' } }[] = [
  {
    card: { role: 'Barista', day: 'Tuesday 20 October', time: '08:00-14:00', member: 'Amara Okafor' },
    badge: { label: 'gallery.badge.upcoming', tone: 'primary' },
  },
  {
    card: { role: 'Night guard', day: 'Friday 23 October', time: '22:00-06:00', member: 'Chidi Eze' },
    badge: { label: 'gallery.badge.open', tone: 'warning' },
  },
];

export const GALLERY_PEOPLE = ['Amara Okafor', 'Chidi Eze', 'Zainab Bello'];
