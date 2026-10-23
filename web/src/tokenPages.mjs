// tokenPages — the two token fallback pages: /magic (PRD 8.1) and /invite/:token (PRD 8.2).
// Static content only: no token is ever written into the HTML (the runtime script builds the
// rowta:// deep link from the fragment / path segment), and nothing here makes a network request.
// Wording never says whether an email has an account (A5, A6) and never leaks a token (W2).

/** Missing-token message: says the link is incomplete or expired and describes how to get a new one. */
export const MAGIC_MISSING_MESSAGE =
  'This sign-in link is incomplete or has expired. Open the Rowta app on your phone and request a new sign-in link from the sign-in screen.';

export const INVITE_MISSING_MESSAGE =
  'This invitation link is incomplete or has expired. Ask the person who invited you to send a new invitation.';

/** /magic — one heading, one short sentence, one primary button (opened only by the runtime script). */
export function magicMain() {
  return `<section class="prose token-page">
    <h1 id="token-heading" tabindex="-1">Sign in to Rowta</h1>
    <p>Open this link on your phone to finish signing in to Rowta. The link works only once and expires soon.</p>
    <p id="token-notice" role="status" aria-live="polite">${MAGIC_MISSING_MESSAGE}</p>
    <a id="open-app" class="button" hidden>Open in the app</a>
  </section>`;
}

/** /invite — same shape plus the "get the app" line, driven by the same build link the landing page uses. */
export function inviteMain(downloadUrl) {
  const cta = downloadUrl
    ? `<a class="button" href="${downloadUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">Get the Android app</a>`
    : `<p class="soon">Download link coming soon</p>`;
  return `<section class="prose token-page">
    <h1 id="token-heading" tabindex="-1">Open your Rowta invitation</h1>
    <p>This invitation opens in the Rowta app on your phone.</p>
    <p id="token-notice" role="status" aria-live="polite">${INVITE_MISSING_MESSAGE}</p>
    <a id="open-app" class="button" hidden>Open in the app</a>
    <p>Rowta is an Android app.</p>
    ${cta}
  </section>`;
}
