// THE TEAMS PAGE MACHINE (Phase 3; rules U1, U2, U7; PRD 6.1) — the signed-in navigation, built
// exactly like the AuthPage machine (state/auth-view.ts): conditional VIEWS in one signed-in
// branch, NO route files, NO navigation library. Root.tsx renders whichever view this store names.
//
// Views:  list       the team list + switcher (also the signed-in home, U2)
//         createTeam the create-team form
//         members    the selected team's members, role changes, removal, leave, settings
//         invite     the invite form + the pending-invitations list + revoke
//
// Actions (pure — scripts/test-teams-view.ts proves them with no device):
//   go    list -> createTeam/members/invite: pushes the current view so Back returns exactly there.
//   back  pops one entry; at an empty stack the machine REFUSES and lets the OS exit (U1).
import { create } from 'zustand';
import type { MessageKey } from '../i18n/en';

export type TeamsView = 'list' | 'createTeam' | 'members' | 'invite' | 'teamSettings';

/** Per-view chrome and focus (PRD 6.1: title, heading, focus target; U7, U8). */
export const TEAMS_VIEWS = {
  list: { title: 'teams.view.list.title', heading: 'teams.view.list.heading', focus: 'heading' },
  createTeam: { title: 'teams.view.create.title', heading: 'teams.view.create.heading', focus: 'input' },
  members: { title: 'teams.view.members.title', heading: 'teams.view.members.heading', focus: 'heading' },
  invite: { title: 'teams.view.invite.title', heading: 'teams.view.invite.heading', focus: 'input' },
  teamSettings: { title: 'teams.view.settings.title', heading: 'teams.view.settings.heading', focus: 'heading' },
} as const satisfies Record<TeamsView, { title: MessageKey; heading: MessageKey; focus: 'input' | 'heading' }>;

export type TeamsMachineState = { view: TeamsView; stack: readonly TeamsView[]; message?: MessageKey };
export type TeamsMachineAction = { type: 'go'; view: TeamsView; message?: MessageKey } | { type: 'back' };

export const initialTeamsState: TeamsMachineState = { view: 'list', stack: [] };

export function teamsReducer(state: TeamsMachineState, action: TeamsMachineAction): TeamsMachineState {
  switch (action.type) {
    case 'go':
      return { view: action.view, stack: [...state.stack, state.view], message: action.message };
    case 'back': {
      const previous = state.stack[state.stack.length - 1];
      if (previous === undefined) return state; // at list (the root): refuse, the OS exits (U1)
      return { view: previous, stack: state.stack.slice(0, -1), message: undefined };
    }
  }
}

export type TeamsViewStore = TeamsMachineState & {
  go: (view: TeamsView, message?: MessageKey) => void;
  /** Pops/returns as described above. Returns false when nothing moved (caller lets Android exit). */
  back: () => boolean;
  /** Landing after an accept/leave/remove/delete: drop the whole stack back to the list (U1 hygiene). */
  resetToList: (message?: MessageKey) => void;
  clearMessage: () => void;
};

function moved(before: TeamsMachineState, after: TeamsMachineState): boolean {
  return after.view !== before.view || after.stack.length !== before.stack.length || after.message !== before.message;
}

export const useTeamsView = create<TeamsViewStore>((set, get) => ({
  ...initialTeamsState,
  go: (view, message) => {
    set((state) => teamsReducer(state, { type: 'go', view, message }));
  },
  back: () => {
    const before = get();
    const after = teamsReducer(before, { type: 'back' });
    if (!moved(before, after)) return false;
    set(after);
    return true;
  },
  resetToList: (message) => set({ view: 'list', stack: [], message }),
  clearMessage: () => set({ message: undefined }),
}));
