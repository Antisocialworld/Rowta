// THE SHIFT PAGES MACHINE (Phase 4; rules U1, U2; PRD 6.1) — conditional views in the signed-in
// branch, exactly like the teams and auth machines: no route files, no navigation library. A null
// route means the team list (Phase 3 home) is showing. Back from the first shift page returns to it;
// at null the machine refuses so Android exits (U1).
import { create } from 'zustand';

export type ShiftRoute =
  | { name: 'calendar' }
  | { name: 'detail'; shiftId: string }
  | { name: 'create' }
  | { name: 'edit'; shiftId: string }
  | { name: 'activity' }
  | { name: 'swaps' };

export type ShiftNavState = { route: ShiftRoute | null; stack: readonly ShiftRoute[] };
export type ShiftNavAction = { type: 'open'; route: ShiftRoute } | { type: 'back' } | { type: 'reset' };

export const initialShiftNavState: ShiftNavState = { route: null, stack: [] };

export function shiftNavReducer(state: ShiftNavState, action: ShiftNavAction): ShiftNavState {
  switch (action.type) {
    case 'open':
      return state.route === null
        ? { route: action.route, stack: [] }
        : { route: action.route, stack: [...state.stack, state.route] };
    case 'back': {
      if (state.route === null) return state;
      const previous = state.stack[state.stack.length - 1];
      if (previous === undefined) return { route: null, stack: [] };
      return { route: previous, stack: state.stack.slice(0, -1) };
    }
    case 'reset':
      return initialShiftNavState;
  }
}

export type ShiftNavStore = ShiftNavState & {
  open: (route: ShiftRoute) => void;
  /** Pops one page; false when there was nothing to pop (the OS may exit). */
  back: () => boolean;
  /** Landing after sign-out, team switch or a completed flow: back to the team list. */
  reset: () => void;
};

export const useShiftNav = create<ShiftNavStore>((set, get) => ({
  ...initialShiftNavState,
  open: (route) => set((state) => shiftNavReducer(state, { type: 'open', route })),
  back: () => {
    const before = get();
    const after = shiftNavReducer(before, { type: 'back' });
    if (after.route === before.route && after.stack.length === before.stack.length) return false;
    set(after);
    return true;
  },
  reset: () => set(initialShiftNavState),
}));
