// WEB-ONLY: the DOM half of the kit Button's X14a not-ready state (form-readiness pass, 22 Oct 2026).
//
// Why a shim exists (verified with app/scripts/probe-form-readiness-web.mjs on the Expo web
// preview, Edge): react-native-web 0.21's Pressable OVERWRITES any `aria-disabled` prop the caller
// passes — its render spreads `{...rest, "aria-disabled": disabled}` where `disabled` is RNW's own
// prop (undefined for the kit Button), and the DOM attr never appears (Pressable/index.js line
// 130). RNW's only route to a rendered aria-disabled is its `disabled` prop, which additionally
// sets tabIndex -1 and — because accessibilityRole="button" renders a NATIVE <button> — the native
// `disabled` attribute (createDOMProps lines 204-209), removing the control from the focus order.
// X14a demands aria-disabled AND stays focusable AND never the native `disabled` attribute, so the
// attribute is set directly on the DOM node here, in the same spirit as web-native-reveal.ts.
// The `accessibilityState={{ disabled }}` prop on the Button stays the native Android channel (X2).
//
// The instance arrives from the Button's ref: a DOM element on web (has setAttribute); a component
// instance on native (no setAttribute — a silent no-op, so no Platform import is needed).
type RemovableAttribute = {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};

function asElement(instance: unknown): RemovableAttribute | null {
  if (typeof instance !== 'object' || instance === null) return null;
  const candidate = instance as Partial<RemovableAttribute>;
  if (typeof candidate.setAttribute !== 'function' || typeof candidate.removeAttribute !== 'function') return null;
  return instance as RemovableAttribute;
}

/** Keeps `aria-disabled="true"` (or its absence) in step with the Button's not-ready/busy state. */
export function syncNotReadyDomState(instance: unknown, waiting: boolean): void {
  const element = asElement(instance);
  if (element === null) return;
  if (waiting) element.setAttribute('aria-disabled', 'true');
  else element.removeAttribute('aria-disabled');
}
