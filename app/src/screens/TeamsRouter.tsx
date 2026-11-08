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
import { DashboardScreen } from './DashboardScreen';
import { TeamListScreen } from './teams/TeamListScreen';
import { MembersScreen } from './teams/MembersScreen';
import { TeamSettingsScreen } from './teams/TeamSettingsScreen';
import { InviteModal } from './teams/InviteModal';
import { ActivityScreen } from './shifts/ActivityScreen';
import { CalendarScreen } from './shifts/CalendarScreen';
import { SearchModal } from './shifts/SearchModal';
import { ShiftCreateEditScreen } from './shifts/ShiftCreateEditScreen';
import { ShiftDetailScreen } from './shifts/ShiftDetailScreen';
import { SwapsListScreen } from './shifts/SwapsListScreen';
import { useTeamsView } from '../state/teams-view';
import { shouldShowDashboard, useTeams } from '../state/teams';
import { useShiftNav } from '../state/shift-nav';
import { BillingScreen, QuoteScreen, MoveBillingScreen } from './billing';

export function TeamsRouter() {
  const view = useTeamsView((state) => state.view);
  const teamsBack = useTeamsView((state) => state.back);
  const shiftRoute = useShiftNav((state) => state.route);
  const shiftBack = useShiftNav((state) => state.back);
  const selectedTeamId = useTeams((state) => state.selectedTeamId);
  const pickingTeam = useTeams((state) => state.pickingTeam);
  const setPickingTeam = useTeams((state) => state.setPickingTeam);

  useEffect(() => {
    if (!shouldListenForHardwareBack(Platform.OS)) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // Shift layer handles back first; falls through to teams layer if nothing to pop.
      if (shiftRoute !== null) {
        return shiftBack();
      }
      if (pickingTeam) {
        setPickingTeam(false);
        return true;
      }
      return teamsBack();
    });
    return () => subscription.remove();
  }, [teamsBack, shiftBack, shiftRoute, pickingTeam, setPickingTeam]);

  // Shift layer renders on top of the teams surface when the machine has a route.
  let screen = shouldShowDashboard(selectedTeamId, pickingTeam) ? <DashboardScreen /> : <TeamListScreen />;
  if (shiftRoute !== null) {
    if (shiftRoute.name === 'calendar') screen = <CalendarScreen />;
    else if (shiftRoute.name === 'detail') screen = <ShiftDetailScreen viewOnly={shiftRoute.viewOnly === true} />;
    else if (shiftRoute.name === 'create') screen = <ShiftCreateEditScreen />;
    else if (shiftRoute.name === 'edit') screen = <ShiftCreateEditScreen />;
    else if (shiftRoute.name === 'activity') screen = <ActivityScreen />;
    else if (shiftRoute.name === 'swaps') screen = <SwapsListScreen />;
  } else if (view === 'members') {
    screen = <MembersScreen />;
  } else if (view === 'teamSettings') {
    screen = <TeamSettingsScreen />;
  } else if (view === 'billing') {
    screen = <BillingScreen />;
  } else if (view === 'quote') {
    screen = <QuoteScreen />;
  } else if (view === 'move-billing') {
    screen = <MoveBillingScreen />;
  }

  return (
    <>
      {screen}
      <InviteModal />
      <SearchModal />
    </>
  );
}
