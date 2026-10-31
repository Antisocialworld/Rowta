// TeamsRouter - the signed-in branch's conditional render (rule U2; PRD 6.1). Replaces the Phase 1
// placeholder as the live signed-in surface for Phase 3: whichever teams-view the machine names
// renders, exactly one at a time, with the Android hardware Back wired to the machine's back()
// (the same pattern AuthPage uses - an empty stack REFUSES so the OS exits, U1). The Phase 8
// Dashboard (PRD §12) will replace the list view's placeholder body later; nothing here is Phase 8.
// Phase 4 adds shift screens: when the shift machine has a route, the shift screen renders over the
// teams surface (same conditional pattern, no navigation library).
import { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';
import { shouldListenForHardwareBack } from '../lib/hardware-back';
import { TeamListScreen } from './teams/TeamListScreen';
import { CreateTeamScreen } from './teams/CreateTeamScreen';
import { MembersScreen } from './teams/MembersScreen';
import { InviteScreen } from './teams/InviteScreen';
import { TeamSettingsScreen } from './teams/TeamSettingsScreen';
import { ActivityScreen } from './shifts/ActivityScreen';
import { CalendarScreen } from './shifts/CalendarScreen';
import { SearchScreen } from './shifts/SearchScreen';
import { ShiftCreateEditScreen } from './shifts/ShiftCreateEditScreen';
import { ShiftDetailScreen } from './shifts/ShiftDetailScreen';
import { SwapsListScreen } from './shifts/SwapsListScreen';
import { useTeamsView } from '../state/teams-view';
import { useShiftNav } from '../state/shift-nav';

export function TeamsRouter() {
  const view = useTeamsView((state) => state.view);
  const teamsBack = useTeamsView((state) => state.back);
  const shiftRoute = useShiftNav((state) => state.route);
  const shiftBack = useShiftNav((state) => state.back);

  useEffect(() => {
    if (!shouldListenForHardwareBack(Platform.OS)) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // Shift layer handles back first; falls through to teams layer if nothing to pop.
      if (shiftRoute !== null) {
        return shiftBack();
      }
      return teamsBack();
    });
    return () => subscription.remove();
  }, [teamsBack, shiftBack, shiftRoute]);

  // Shift layer renders on top of the teams surface when the machine has a route.
  if (shiftRoute !== null) {
    if (shiftRoute.name === 'calendar') return <CalendarScreen />;
    if (shiftRoute.name === 'detail') return <ShiftDetailScreen />;
    if (shiftRoute.name === 'create') return <ShiftCreateEditScreen />;
    if (shiftRoute.name === 'edit') return <ShiftCreateEditScreen />;
    if (shiftRoute.name === 'activity') return <ActivityScreen />;
    if (shiftRoute.name === 'search') return <SearchScreen />;
    if (shiftRoute.name === 'swaps') return <SwapsListScreen />;
  }

  // Teams layer
  if (view === 'createTeam') return <CreateTeamScreen />;
  if (view === 'members') return <MembersScreen />;
  if (view === 'invite') return <InviteScreen />;
  if (view === 'teamSettings') return <TeamSettingsScreen />;
  return <TeamListScreen />;
}
