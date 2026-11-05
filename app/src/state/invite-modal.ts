// State store for InviteModal (Stage M3; rules U1, U7, X14; PRD 6.1, 8.2).
// Allows opening the Invite modal from both TeamListScreen and MembersScreen
// while maintaining focus return ref to the invoking trigger.
import { create } from 'zustand';

export type InviteModalTrigger = 'teamList' | 'members' | null;

export type InviteModalStore = {
  visible: boolean;
  trigger: InviteModalTrigger;
  returnFocusRef: { current: unknown } | null;
  open: (trigger?: InviteModalTrigger, returnFocusRef?: { current: unknown } | null) => void;
  close: () => void;
};

export const useInviteModal = create<InviteModalStore>((set) => ({
  visible: false,
  trigger: null,
  returnFocusRef: null,
  open: (trigger = null, returnFocusRef = null) => set({ visible: true, trigger, returnFocusRef }),
  close: () => set({ visible: false, trigger: null, returnFocusRef: null }),
}));

