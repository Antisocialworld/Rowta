// WEB-ONLY: hide the browser's native password-reveal control (rule X1; item D of the 22 Oct 2026 web pass).
//
// Diagnosis (verified with app/scripts/probe-auth-web.mjs on Edge): the kit renders exactly ONE reveal
// control per password field — the labelled Pressable in components/Input.tsx (aria-label from
// action.showPassword / action.hidePassword). The second eye the owner sees in Edge is the browser's own
// reveal button on <input type="password"> (Edge's ::-ms-reveal pseudo-element). There is no React element
// to remove; the fix is one CSS rule that hides the native control and keeps the accessible app toggle.
//
// Why a style tag and not a CSS file import: the app is a bare Expo/Metro bundle with no CSS entry, and
// this rule must exist before the first password field renders. The rule carries no colour, size, radius
// or user-facing string (rule 5 / U5 do not apply to platform plumbing of this kind).
import { Platform } from 'react-native';

let installed = false;

/** Idempotent; call once from App.tsx. No-op on native (Platform.OS !== 'web') and outside a DOM. */
export function hideNativePasswordReveal(): void {
  if (installed) return;
  if (Platform.OS !== 'web') return;
  if (typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = 'input::-ms-reveal { display: none; }';
  document.head.append(style);
  installed = true;
}
