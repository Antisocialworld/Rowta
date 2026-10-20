// rowta.js — the ONLY script on the web surface (ADR 0006). Progressive enhancement:
// announce the document title into the polite live region when the view loads (W3/X3), so the title change
// of a navigation is announced. Everything else — all content, links and metadata — works with JavaScript off.
// It stores nothing: no cookies, no localStorage, no requests beyond the page itself.
(function () {
  function announce() {
    var region = document.getElementById('view-announcer');
    if (region && document.title) region.textContent = document.title;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announce);
  } else {
    announce();
  }
})();
