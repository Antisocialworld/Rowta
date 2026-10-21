// VerifyCodeView — PRD 6.1 step "verify code" inside the AuthPage card (heading rendered by the page).
// Phase 2: the real POST /auth/signup/verify with the email carried in the flow context (the view
// unmounts between steps, so the address cannot live in local state). Success returns TOKENS — the
// session store takes them (A11) and the root render switches to the signed-in branch (S5). The
// resend control and countdown live in the shared CodeStep (A9).
import { authApi } from '../../lib/api';
import { useAuthSession } from '../../state/auth-session';
import { useAuthFlow } from '../../state/auth-context';
import { CodeStep } from './CodeStep';

export function VerifyCodeView() {
  const email = useAuthFlow((state) => state.email);
  const signInWithTokens = useAuthSession((state) => state.signInWithTokens);

  return (
    <CodeStep
      testIDPrefix="verify"
      verify={async (code) => {
        const tokens = await authApi.verifyCode({ email, code });
        await signInWithTokens(tokens);
        return true;
      }}
      resend={async () => (await authApi.resendCode({ email })).meta}
    />
  );
}
