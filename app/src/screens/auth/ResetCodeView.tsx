// ResetCodeView — PRD 6.1 step "reset code" inside the AuthPage card (heading rendered by the page).
// Phase 2: the real POST /auth/forgot/verify returns the 10-minute GRANT plus its remaining-SECONDS
// timer (A10, A9); both land in the flow context and the machine moves to resetPassword. Resend is
// POST /auth/forgot/resend. The shared CodeStep owns the field, countdown and error lines.
import { authApi } from '../../lib/api';
import { useAuthFlow } from '../../state/auth-context';
import { useAuthViewStore } from '../../state/auth-view';
import { CodeStep } from './CodeStep';

export function ResetCodeView() {
  const go = useAuthViewStore((state) => state.go);
  const email = useAuthFlow((state) => state.email);
  const setFlow = useAuthFlow((state) => state.setFlow);

  return (
    <CodeStep
      testIDPrefix="reset-code"
      verify={async (code) => {
        const result = await authApi.forgotVerify({ email, code });
        setFlow({ grant: result.data.grant, grantMeta: result.meta });
        go('resetPassword');
        return true;
      }}
      resend={async () => (await authApi.forgotResend({ email })).meta}
    />
  );
}
