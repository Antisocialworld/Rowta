// State store for SearchModal (Stage M4a; rules U1, U7, X14; PRD 6.1, 8.4).
// Search is an accessible top-anchored modal sheet mounted over any team surface.
import { create } from 'zustand';

export type SearchModalStore = {
  visible: boolean;
  returnFocusRef: { current: unknown } | null;
  open: (returnFocusRef?: { current: unknown } | null) => void;
  close: () => void;
};

export const useSearchModal = create<SearchModalStore>((set) => ({
  visible: false,
  returnFocusRef: null,
  open: (returnFocusRef = null) => set({ visible: true, returnFocusRef }),
  close: () => set({ visible: false, returnFocusRef: null }),
}));

