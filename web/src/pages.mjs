// pages — the ONE registry of public pages (W1: one pageMeta per page, unique titles and descriptions).
// `source` is the markdown file in docs/legal/ that renders into the layout. `current` marks the nav item.
// Token pages (magic, invite) are `noindex` (W2) with a `canonicalPath` that carries NO token: they are
// excluded from SITEMAP_PAGES by the noindex flag and never put a token in any built file.

export const PAGES = [
  {
    key: 'index',
    path: '/',
    type: 'website',
    special: 'landing',
    title: 'Rowta - shift scheduling for teams',
    description:
      'Plan shifts on a calendar that works offline, approve swaps, and get notifications that respect quiet hours. Read how Rowta handles your data.',
    keywords: 'shift scheduling, rota, work schedule, team shifts, swaps, Nigeria',
    current: 'download',
  },
  {
    key: 'privacy',
    path: '/privacy/',
    source: 'docs/legal/privacy.md',
    title: 'Privacy Policy - Rowta',
    description:
      'What Rowta collects and why, how long it is kept, who receives it, your rights by region, and how to ask questions or delete your data by email.',
    keywords: 'privacy policy, personal data, data retention, rights, Rowta',
    current: 'privacy',
  },
  {
    key: 'terms',
    path: '/terms/',
    source: 'docs/legal/terms.md',
    title: 'Terms of Service - Rowta',
    description:
      'The rules for using Rowta: who can use it, accounts, subscriptions, ownership, changes to these terms, and the law that applies.',
    keywords: 'terms of service, terms, conditions, Rowta',
    current: 'terms',
  },
  {
    key: 'billing-terms',
    path: '/billing-terms/',
    source: 'docs/legal/billing-terms.md',
    title: 'Billing Terms - Rowta',
    description:
      'Rowta plans, seats, prorated plan changes, the 7-day grace period and restricted state, refunds, taxes, and test-mode payments.',
    keywords: 'billing, subscription, seats, proration, grace period, refunds, Rowta',
  },
  {
    key: 'delete-account',
    path: '/delete-account/',
    source: 'docs/legal/delete-account.md',
    title: 'Delete Your Account - Rowta',
    description:
      'How to delete your Rowta account and data in the app or by email, what is deleted, what is kept and for how long, and the 30-day grace period.',
    keywords: 'delete account, erase data, account deletion, Rowta',
  },
  {
    key: 'subprocessors',
    path: '/subprocessors/',
    source: 'docs/legal/subprocessors.md',
    title: 'Subprocessors - Rowta',
    description:
      'The outside companies that handle Rowta data: what each one does, what data it sees, and whether it is active today or only planned.',
    keywords: 'subprocessors, third parties, vendors, processors, Rowta',
  },
  {
    key: 'data-retention',
    path: '/data-retention/',
    source: 'docs/legal/data-retention.md',
    title: 'Data Retention - Rowta',
    description:
      'How long Rowta keeps each kind of data: purpose, retention time, deletion trigger, and whether the rule is active today or planned.',
    keywords: 'data retention, deletion, purge, storage periods, Rowta',
  },
  {
    key: 'accessibility',
    path: '/accessibility/',
    source: 'docs/legal/accessibility.md',
    title: 'Accessibility - Rowta',
    description:
      "Rowta's accessibility target, what has actually been tested, the known gaps, and how to tell us when something does not work.",
    keywords: 'accessibility, WCAG, TalkBack, NVDA, keyboard, Rowta',
  },
  {
    key: 'contact',
    path: '/contact/',
    source: 'docs/legal/contact.md',
    title: 'Contact - Rowta',
    description:
      'Contact Rowta by email for privacy, deletion, legal or security questions: rowtareply@gmail.com. Email is the only contact channel.',
    keywords: 'contact, support email, privacy contact, security contact, Rowta',
  },
  {
    // /magic — the https fallback page for the magic-link email (PRD 8.1, A13). The token lives only in
    // the URL fragment at runtime; the built file contains no token and sends no request on load.
    key: 'magic',
    path: '/magic/',
    canonicalPath: '/magic', // the clean URL the email link uses: PUBLIC_WEB_URL + /magic#<token>
    type: 'website',
    special: 'magic',
    noindex: true,
    title: 'Sign in to Rowta',
    description:
      'Open your Rowta sign-in link in the Rowta app on your phone. The link is short-lived, works once, and this page never asks for a password.',
    keywords: 'sign in link, magic link, Rowta',
  },
  {
    // /invite/:token — web fallback for the team invitation link (PRD 8.2, 8.1). One static page is
    // served for any /invite/<segment> (Vercel rewrite); the token is read from the path at runtime
    // only to build the rowta://invite/<token> link. No network request, no token in the file.
    key: 'invite',
    path: '/invite/',
    canonicalPath: '/invite/', // the clean URL without the token
    type: 'website',
    special: 'invite',
    noindex: true,
    title: 'Open your Rowta invitation',
    description:
      'Open a Rowta team invitation in the Rowta app on your phone, or get the Android app if you do not have Rowta yet.',
    keywords: 'team invitation, invite link, Rowta',
  },
  {
    // /billing/complete — static fallback page after hosted checkout (PRD 8.1, I3).
    // The page makes no network calls, does not store or send the query string,
    // has noindex and no-referrer, and tries to open rowta://billing/complete.
    key: 'billing-complete',
    path: '/billing/complete/',
    canonicalPath: '/billing/complete',
    type: 'website',
    special: 'billing-complete',
    noindex: true,
    referrer: 'no-referrer',
    title: 'Billing return - Rowta',
    description:
      'If you paid, Rowta will update in a moment. Return to the Rowta app on your phone.',
    keywords: 'billing, complete, subscription, Rowta',
  },
  {
    key: 'notfound',
    path: '/404.html',
    noindex: true,
    special: 'notfound',
    title: 'Page not found - Rowta',
    description: 'This page does not exist. Return to the Rowta home page or use the links on this page.',
    keywords: 'not found, Rowta',
  },
];

/** Pages that appear in sitemap.xml (public, indexable, no token pages). */
export const SITEMAP_PAGES = PAGES.filter((page) => !page.noindex && page.path !== '/404.html');
