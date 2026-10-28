// TeamsRouter — the signed-in branch's conditional render (rule U2; PRD 6.1). Replaces the Phase 1
// placeholder as the live signed-in surface for Phase 3: whichever teams-view the machine names
// renders, exactly one at a time, with the Android hardware Back wired to the machine's back()
// (the same pattern AuthPage uses — an empty stack REFUSES so the OS exits, U1). The Phase 8
// Dashboard (PRD §12) will replace the list view's placeholder body later; nothing here is Phase 8.
import { useEffect } from 'react';
import { BackHandler } from 'react-native';
import { TeamListScreen } from './teams/TeamListScreen';
import { CreateTeamScreen } from './teams/CreateTeamScreen';
import { MembersScreen } from './teams/MembersScreen';
import { InviteScreen } from './teams/InviteScreen';
import { useTeamsView } from '../state/teams-view';

export function TeamsRouter() {
  const view = useTeamsView((state) => state.view);
  const back = useTeamsView((state) => state.back);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => back());
    return () => subscription.remove();
  }, [back]);

  if (view === 'createTeam') return <CreateTeamScreen />;
  if (view === 'members') return <MembersScreen />;
  if (view === 'invite') return <InviteScreen />;
  return <TeamListScreen />;
}
