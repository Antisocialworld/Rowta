// token-page.js — runtime for the two token fallback pages only (/magic and /invite).
//
// Security contract (PRD 8.1, 8.2; rule A13, skill 3.15):
//   * NO network request of any kind: opening the page never consumes the token, so an email
//     security scanner that merely fetches the URL cannot use it up.
//   * The token is read locally ONLY from the URL fragment (magic and invite),
//     is never logged, never written to the title, and appears in the DOM in exactly one place:
//     the href of the rowta:// deep link behind "Open in the app".
//   * The token is removed from the address bar with history.replaceState right after reading —
//     on BOTH pages (invite strip: owner decision 4, 26 Oct 2026; reload after the strip shows
//     the built-in no-token message).
//   * A no-referrer policy is applied to this page so the token-bearing URL is never sent to a
//     third party in a Referer header (decision 4).
//   * No token (or a malformed one) keeps the built-in message visible and the button hidden.
(function () {
  var SAFE = /^[A-Za-z0-9._~-]{1,512}$/;

  function applyNoReferrer() {
    // The meta element must exist BEFORE any navigation the page could trigger; injecting it here
    // (before the deep-link button is even revealed) covers the page itself and its outgoing links.
    var meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
  }

  function focusHeading() {
    var heading = document.getElementById('token-heading');
    if (heading) heading.focus();
  }

  function reveal(kind, token) {
    var notice = document.getElementById('token-notice');
    var button = document.getElementById('open-app');
    if (!button || !SAFE.test(token)) return false;
    if (notice) {
      notice.textContent = '';
      notice.hidden = true;
    }
    button.href = 'rowta://' + kind + '/' + token;
    button.hidden = false;
    return true;
  }

  function readToken() {
    var kind = document.body.getAttribute('data-token-kind') || '';
    if (kind === 'magic' || kind === 'invite') {
      var fragment = window.location.hash ? window.location.hash.slice(1) : '';
      // Read first, then strip the fragment from the address bar immediately (skill 3.20 step 2).
      if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      return fragment;
    }
    return '';
  }

  function start() {
    applyNoReferrer();
    var kind = document.body.getAttribute('data-token-kind') || '';
    if (kind === 'billing-complete') {
      if (window.location.search || window.location.hash) {
        history.replaceState(null, '', window.location.pathname);
      }
      var button = document.getElementById('open-app');
      if (button) {
        button.href = 'rowta://billing/complete';
        button.hidden = false;
      }
      focusHeading();
      try {
        window.location.href = 'rowta://billing/complete';
      } catch (_) {}
      return;
    }
    var token = readToken();
    if (!token || !reveal(kind, token)) {
      // No usable token: the built-in "incomplete or expired" message stays visible, no button.
      var button = document.getElementById('open-app');
      if (button) button.hidden = true;
    }
    focusHeading();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
