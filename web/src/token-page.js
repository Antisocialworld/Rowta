// token-page.js — runtime for the two token fallback pages only (/magic and /invite/:token).
//
// Security contract (PRD 8.1, 8.2; rule A13, skill 3.15):
//   * NO network request of any kind: opening the page never consumes the token, so an email
//     security scanner that merely fetches the URL cannot use it up.
//   * The token is read locally ONLY from the URL fragment (magic) or the path segment (invite),
//     is never logged, never written to the title, and appears in the DOM in exactly one place:
//     the href of the rowta:// deep link behind "Open in the app".
//   * The fragment is removed from the address bar with history.replaceState right after reading.
//   * No token (or a malformed one) keeps the built-in message visible and the button hidden.
(function () {
  var SAFE = /^[A-Za-z0-9._~-]{1,512}$/;

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
    if (kind === 'magic') {
      var fragment = window.location.hash ? window.location.hash.slice(1) : '';
      // Read first, then strip the fragment from the address bar immediately (skill 3.20 step 2).
      if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      return fragment;
    }
    if (kind === 'invite') {
      var parts = window.location.pathname.split('/').filter(Boolean);
      // Exactly /invite/<segment>; anything else (bare /invite, deeper paths) is incomplete.
      if (parts.length === 2 && parts[0] === 'invite') return parts[1];
      return '';
    }
    return '';
  }

  function start() {
    var kind = document.body.getAttribute('data-token-kind') || '';
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
