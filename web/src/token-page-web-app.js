// token-page-web-app.js — DEV-ONLY capture block. web/build.mjs PREPENDS this file to the built
// token-page.js ONLY when WEB_APP_URL was set (owner decision 28 Oct 2026); the default build
// never contains it. ORDER CONTRACT (owner browser check, 28 Oct 2026): this block must run
// BEFORE the base token-page.js start() strips the address — under `defer` the base runs
// immediately at script evaluation, so an appended block reads an already-stripped location.
// It captures the token into a closure at evaluation time and reveals the "Open in the web app"
// link (href = WEB_APP_URL + "/" + kind + "/" + token, built at runtime only). The token exists
// only inside the href, is never logged, and nothing here makes a network request. The SAFE
// shape duplicates the base page's on purpose: the base script must stay byte-identical for
// default builds.
(function () {
  var SAFE = /^[A-Za-z0-9._~-]{1,512}$/;
  var kind = document.body.getAttribute('data-token-kind') || '';
  var token = '';
  if (kind === 'magic') {
    token = window.location.hash ? window.location.hash.slice(1) : '';
  } else if (kind === 'invite') {
    var parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length === 2 && parts[0] === 'invite') token = parts[1];
  }
  function reveal() {
    var link = document.getElementById('open-web-app');
    if (!link) return;
    var base = link.getAttribute('data-web-app-origin') || '';
    if (!base || !SAFE.test(token)) return;
    link.href = base + '/' + kind + '/' + token;
    link.hidden = false;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reveal);
  } else {
    reveal();
  }
})();
