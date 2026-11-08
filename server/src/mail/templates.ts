// Email templates — final wording from skill rowta-notifications-email-recipes section 7
// (owner-approved texts; edit only with the owner).
//
// Rules baked in here: plain-text part first with the same words in the HTML part; subjects are
// neutral and contain no digits, code, token or amount; the greeting is "Hi <name>," or "Hi,";
// the name is stripped of line breaks and HTML-escaped (V8); minutes and seconds come from the
// shared constants so they can never drift (A9); links are https links built from PUBLIC_WEB_URL;
// every message ends with the automated-message footer and "The Rowta team".
import {
  CODE_TTL_SECONDS,
  MAGIC_LINK_TTL_SECONDS,
  RESEND_COOLDOWN_SECONDS,
} from '@rowta/shared';
import { env } from '../config/env.ts';

const AUTO_FOOTER = 'This is an automated message. Please do not reply.';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** "Hi <name>," with line breaks removed, or "Hi," when there is no name (skill 7, V8). */
export function greeting(name: string | null | undefined): string {
  const cleaned = typeof name === 'string' ? name.replace(/[\r\n]+/g, ' ').trim() : '';
  return cleaned.length > 0 ? `Hi ${cleaned},` : 'Hi,';
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", "&#39;");
}

const codeMinutes = CODE_TTL_SECONDS / 60;
const resendSeconds = RESEND_COOLDOWN_SECONDS;
const magicMinutes = MAGIC_LINK_TTL_SECONDS / 60;

/** Wrap finished lines into the shared HTML shell (same words as the text part). */
function htmlShell(title: string, paragraphs: string[]): string {
  const body = paragraphs.map((p) => `    <p>${p}</p>`).join('\n');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    `    <meta charset="utf-8">`,
    `    <title>${escapeHtml(title)}</title>`,
    '  </head>',
    '  <body>',
    body,
    '  </body>',
    '</html>',
  ].join('\n');
}

function textEmail(lines: string[]): string {
  return `${lines.join('\n\n')}\n`;
}

/** 7.1 Sign-up verification code. */
export function signupCodeEmail(input: { name: string | null; code: string }): RenderedEmail {
  const subject = 'Your Rowta verification code';
  const greetingLine = greeting(input.name);
  const text = textEmail([
    greetingLine,
    `Your Rowta verification code is:\n\n${input.code}`,
    `This code expires in ${codeMinutes} minutes. Enter it in the app to finish creating your account.`,
    `You can ask for a new code after ${resendSeconds} seconds if this one runs out.`,
    'If you did not try to create a Rowta account, you can ignore this email. No account will be created.',
    'Rowta will never ask you for this code or your password by phone, chat or email. Do not share it with anyone.',
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const html = htmlShell(subject, [
    escapeHtml(greetingLine),
    'Your Rowta verification code is:',
    `<p style="font-family: monospace; font-size: 24px; letter-spacing: 4px;">${input.code}</p>`,
    `This code expires in ${codeMinutes} minutes. Enter it in the app to finish creating your account.`,
    `You can ask for a new code after ${resendSeconds} seconds if this one runs out.`,
    'If you did not try to create a Rowta account, you can ignore this email. No account will be created.',
    'Rowta will never ask you for this code or your password by phone, chat or email. Do not share it with anyone.',
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}

/** 7.2 Password reset code. */
export function resetCodeEmail(input: { name: string | null; code: string }): RenderedEmail {
  const subject = 'Your Rowta password reset code';
  const greetingLine = greeting(input.name);
  const text = textEmail([
    greetingLine,
    `Use this code to reset your Rowta password:\n\n${input.code}`,
    `This code expires in ${codeMinutes} minutes. You can ask for a new code after ${resendSeconds} seconds.`,
    'If you did not ask to reset your password, you can ignore this email. Your password has not changed.',
    'Rowta will never ask you for this code or your password by phone, chat or email.',
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const html = htmlShell(subject, [
    escapeHtml(greetingLine),
    'Use this code to reset your Rowta password:',
    `<p style="font-family: monospace; font-size: 24px; letter-spacing: 4px;">${input.code}</p>`,
    `This code expires in ${codeMinutes} minutes. You can ask for a new code after ${resendSeconds} seconds.`,
    'If you did not ask to reset your password, you can ignore this email. Your password has not changed.',
    'Rowta will never ask you for this code or your password by phone, chat or email.',
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}

/** 7.3 Welcome — sent once, after the account row exists (send-once guard in the job, C4). */
export function welcomeEmail(input: { name: string | null; webLink: string }): RenderedEmail {
  const subject = 'Welcome to Rowta';
  const greetingLine = greeting(input.name);
  const webLink = escapeHtml(input.webLink);
  const text = textEmail([
    greetingLine,
    'Welcome to Rowta. Your account is ready.',
    'To get started:\n1. Create your team, or accept an invitation if someone invited you.\n2. Add your shifts to the calendar.\n3. Turn on notifications so you hear about shift changes and swap requests.',
    `Open Rowta: ${input.webLink}`,
    'Good to know:\n- Sign in with your email and password, or ask for a sign-in link by email.\n- If you forget your password, choose "Forgot password" on the sign-in screen. We will send a 6-digit code to this address. It expires in 5 minutes.\n- Rowta will never ask for your password or a code by phone, chat or email.',
    'If you did not create this account, open the app and choose "Forgot password" to take control of it.',
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const html = htmlShell(subject, [
    escapeHtml(greetingLine),
    '<p>Welcome to Rowta. Your account is ready.</p>',
    '<p>To get started:</p>',
    '<ol><li>Create your team, or accept an invitation if someone invited you.</li><li>Add your shifts to the calendar.</li><li>Turn on notifications so you hear about shift changes and swap requests.</li></ol>',
    `<p>Open Rowta: <a href="${webLink}">${webLink}</a></p>`,
    '<p>Good to know:</p>',
    '<ul><li>Sign in with your email and password, or ask for a sign-in link by email.</li><li>If you forget your password, choose "Forgot password" on the sign-in screen. We will send a 6-digit code to this address. It expires in 5 minutes.</li><li>Rowta will never ask for your password or a code by phone, chat or email.</li></ul>',
    'If you did not create this account, open the app and choose "Forgot password" to take control of it.',
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}

/** 7.4 Someone tried to sign up with an address that already has an account (changes nothing). */
export function signupNoticeEmail(input: { name: string | null }): RenderedEmail {
  const subject = 'A sign-up was attempted with your email';
  const greetingLine = greeting(input.name);
  const text = textEmail([
    greetingLine,
    'Someone tried to create a Rowta account with this email address, but an account already exists.',
    'If it was you, sign in, or choose "Forgot password" on the sign-in screen if you cannot remember your password.',
    'If it was not you, you can ignore this email. Nothing has changed.',
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const html = htmlShell(subject, [
    escapeHtml(greetingLine),
    'Someone tried to create a Rowta account with this email address, but an account already exists.',
    'If it was you, sign in, or choose "Forgot password" on the sign-in screen if you cannot remember your password.',
    'If it was not you, you can ignore this email. Nothing has changed.',
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}

/**
 * 7.5 Magic sign-in link. The lifetime comes from the shared constant (MAGIC_LINK_TTL_SECONDS),
 * which the owner set to 5 minutes — the template never hard-codes a number.
 */
export function magicLinkEmail(input: { name: string | null; magicLink: string }): RenderedEmail {
  const subject = 'Your Rowta sign-in link';
  const greetingLine = greeting(input.name);
  const magicLink = escapeHtml(input.magicLink);
  const text = textEmail([
    greetingLine,
    `Use this link to sign in to Rowta. Open it, then press the "Sign in" button:\n\n${input.magicLink}`,
    `The link expires in ${magicMinutes} minutes and works once. If you did not ask for it, you can ignore this email.`,
    'Rowta will never ask you for your password or a code by phone, chat or email. Do not forward this email: anyone who has the link can sign in as you until it expires or is used.',
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const html = htmlShell(subject, [
    escapeHtml(greetingLine),
    `Use this link to sign in to Rowta. Open it, then press the "Sign in" button:`,
    `<p><a href="${magicLink}" rel="noreferrer">${magicLink}</a></p>`,
    `The link expires in ${magicMinutes} minutes and works once. If you did not ask for it, you can ignore this email.`,
    'Rowta will never ask you for your password or a code by phone, chat or email. Do not forward this email: anyone who has the link can sign in as you until it expires or is used.',
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}

/** The canonical magic link: https page, token in the URL FRAGMENT (A13, skill 3.20). */
export function magicLinkUrl(token: string): string {
  return `${env.PUBLIC_WEB_URL.replace(/\/+$/, '')}/magic#${token}`;
}

/** The landing link used by the welcome email (https web page that opens the app). */
export function webHomeUrl(): string {
  return `${env.PUBLIC_WEB_URL.replace(/\/+$/, '')}/`;
}

/** The canonical invite link: https page with the token path (PRD 8.2; Owner Decision 3). */
export function inviteUrl(token: string): string {
  return `${env.PUBLIC_WEB_URL.replace(/\/+$/, '')}/invite/${token}`;
}

export function inviteEmail(input: {
  teamName: string;
  inviterName: string | null;
  role: string;
  inviteUrl: string;
}): RenderedEmail {
  const subject = `You have been invited to join ${input.teamName} on Rowta`;
  const inviterText = input.inviterName ? `${input.inviterName} has invited you` : 'You have been invited';
  const text = textEmail([
    'Hi,',
    `${inviterText} to join "${input.teamName}" as a ${input.role} on Rowta.`,
    `Use this link to accept the invitation:\n\n${input.inviteUrl}`,
    'The invitation is valid for 7 days and can only be used once.',
    'If you did not expect this invitation, you can safely ignore this email.',
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const safeUrl = escapeHtml(input.inviteUrl);
  const html = htmlShell(subject, [
    'Hi,',
    `${escapeHtml(inviterText)} to join "${escapeHtml(input.teamName)}" as a ${escapeHtml(input.role)} on Rowta.`,
    `Use this link to accept the invitation:`,
    `<p><a href="${safeUrl}" rel="noreferrer">${safeUrl}</a></p>`,
    'The invitation is valid for 7 days and can only be used once.',
    'If you did not expect this invitation, you can safely ignore this email.',
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}

// -----------------------------------------------------------------------------------
// T17 — Billing move notices (7 Nov 2026 owner decisions).
// Placeholders: {team}, {name}, {from}, {date}. Plain text first, same words in HTML.
// No push tokens or secrets in payloads.
// -----------------------------------------------------------------------------------

/** T17 #1 — transfer_still_paying: the payer (registry owner), from transferTeam only when
 *  the payer is not the new Admin. Must not touch any billing column. */
export function transferStillPayingEmail(input: {
  name: string | null;
  team: string;
  from: string;
}): RenderedEmail {
  const name = input.name ?? '';
  const subject = `You still pay for ${input.team}`;
  const greetingLine = greeting(input.name);
  const text = textEmail([
    greetingLine,
    `You made ${name} the Admin of ${input.team}. Billing did not move. You keep paying for this team until you move billing to ${name}.`,
    'Open Rowta, go to Billing, then Move billing.',
    `${name} must accept.`,
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const html = htmlShell(subject, [
    escapeHtml(greetingLine),
    `<p>You made ${escapeHtml(name)} the Admin of ${escapeHtml(input.team)}. Billing did not move. You keep paying for this team until you move billing to ${escapeHtml(name)}.</p>`,
    '<p>Open Rowta, go to Billing, then Move billing.</p>',
    `<p>${escapeHtml(name)} must accept.</p>`,
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}

/** T17 #2 — billing.move_requested: the receiver. */
export function moveRequestedEmail(input: {
  team: string;
  from: string;
  date: string;
}): RenderedEmail {
  const subject = `${input.from} asked you to take over billing for ${input.team}`;
  const greetingLine = greeting(null);
  const text = textEmail([
    greetingLine,
    `${input.from} asked you to pay for ${input.team} from your Rowta account.`,
    'If you accept, you are responsible for paying.',
    'If you have no plan, you get a 14-day free trial.',
    `If your plan does not cover the team yet, the team is read-only for everyone until you pay.`,
    `Accept or decline in Rowta before ${input.date}.`,
    `If you do nothing, the request ends and ${input.from} keeps paying.`,
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const html = htmlShell(subject, [
    escapeHtml(greetingLine),
    `<p>${escapeHtml(input.from)} asked you to pay for ${escapeHtml(input.team)} from your Rowta account.</p>`,
    '<p>If you accept, you are responsible for paying.</p>',
    '<p>If you have no plan, you get a 14-day free trial.</p>',
    `<p>If your plan does not cover the team yet, the team is read-only for everyone until you pay.</p>`,
    `<p>Accept or decline in Rowta before ${escapeHtml(input.date)}.</p>`,
    `<p>If you do nothing, the request ends and ${escapeHtml(input.from)} keeps paying.</p>`,
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}

/** T17 #3 — billing.move_accepted: the previous payer. */
export function moveAcceptedEmail(input: {
  name: string | null;
  team: string;
}): RenderedEmail {
  const name = input.name ?? '';
  const subject = `Billing for ${input.team} has moved`;
  const greetingLine = greeting(input.name);
  const text = textEmail([
    greetingLine,
    `${name} accepted. From now on you are not billed for ${input.team}.`,
    'What you already paid for this period is not refunded.',
    'Your other teams are unchanged.',
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const html = htmlShell(subject, [
    escapeHtml(greetingLine),
    `<p>${escapeHtml(name)} accepted. From now on you are not billed for ${escapeHtml(input.team)}.</p>`,
    '<p>What you already paid for this period is not refunded.</p>',
    '<p>Your other teams are unchanged.</p>',
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}

/** T17 #4 — billing.move_declined: the previous payer. */
export function moveDeclinedEmail(input: {
  name: string | null;
  team: string;
}): RenderedEmail {
  const name = input.name ?? '';
  const subject = `${name} declined to take over billing for ${input.team}`;
  const greetingLine = greeting(input.name);
  const text = textEmail([
    greetingLine,
    `You still pay for ${input.team}.`,
    'You can ask someone else, or send the request again later.',
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const html = htmlShell(subject, [
    escapeHtml(greetingLine),
    `<p>You still pay for ${escapeHtml(input.team)}.</p>`,
    '<p>You can ask someone else, or send the request again later.</p>',
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}

/** T17 #5 — billing.move_cancelled: the receiver. */
export function moveCancelledEmail(input: {
  team: string;
  from: string;
}): RenderedEmail {
  const subject = `Billing request for ${input.team} cancelled`;
  const greetingLine = greeting(null);
  const text = textEmail([
    greetingLine,
    `${input.from} cancelled the request. You do not need to do anything.`,
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const html = htmlShell(subject, [
    escapeHtml(greetingLine),
    `<p>${escapeHtml(input.from)} cancelled the request. You do not need to do anything.</p>`,
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}

/** T17 #6 — billing.move_expired: the previous payer. */
export function moveExpiredEmail(input: {
  name: string | null;
  team: string;
  date: string;
}): RenderedEmail {
  const name = input.name ?? '';
  const subject = `Your billing request for ${input.team} ended`;
  const greetingLine = greeting(input.name);
  const text = textEmail([
    greetingLine,
    `The request ended on ${input.date} because ${name} did not answer.`,
    `You still pay for ${input.team}.`,
    'To try again, open Rowta, go to Billing, then Move billing.',
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const html = htmlShell(subject, [
    escapeHtml(greetingLine),
    `<p>The request ended on ${escapeHtml(input.date)} because ${escapeHtml(name)} did not answer.</p>`,
    `<p>You still pay for ${escapeHtml(input.team)}.</p>`,
    '<p>To try again, open Rowta, go to Billing, then Move billing.</p>',
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}

/** T17 #7 — billing.move_payment_needed: the receiver (after accept in outcome c). */
export function movePaymentNeededEmail(input: {
  name: string | null;
  team: string;
}): RenderedEmail {
  const subject = `Pay to unlock ${input.team}`;
  const greetingLine = greeting(input.name);
  const text = textEmail([
    greetingLine,
    `You now pay for ${input.team}, but your plan does not cover it yet, so the team is read-only for everyone.`,
    'Open Rowta, go to Billing, and add the team or subscribe.',
    'Your data is safe.',
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const html = htmlShell(subject, [
    escapeHtml(greetingLine),
    `<p>You now pay for ${escapeHtml(input.team)}, but your plan does not cover it yet, so the team is read-only for everyone.</p>`,
    '<p>Open Rowta, go to Billing, and add the team or subscribe.</p>',
    '<p>Your data is safe.</p>',
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}

/** T17 #8 — billing.move_trial_started: the receiver (after accept in outcome a). */
export function moveTrialStartedEmail(input: {
  team: string;
  date: string;
}): RenderedEmail {
  const subject = `You now pay for ${input.team}: free trial until ${input.date}`;
  const greetingLine = greeting(null);
  const text = textEmail([
    greetingLine,
    `Your 14-day free trial ends on ${input.date}.`,
    `Subscribe before then or ${input.team} becomes read-only for everyone.`,
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const html = htmlShell(subject, [
    escapeHtml(greetingLine),
    `<p>Your 14-day free trial ends on ${escapeHtml(input.date)}.</p>`,
    `<p>Subscribe before then or ${escapeHtml(input.team)} becomes read-only for everyone.</p>`,
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}

/** A2(a) — billing.plan_cancelled: team Admin notice when payer cancels. */
export function planCancelledEmail(input: { date: string }): RenderedEmail {
  const subject = 'Plan cancelled';
  const greetingLine = greeting(null);
  const text = textEmail([
    greetingLine,
    `This team's plan was cancelled. It stays fully active until ${input.date}, then becomes read-only. Nothing is deleted.`,
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const html = htmlShell(subject, [
    escapeHtml(greetingLine),
    `<p>This team's plan was cancelled. It stays fully active until ${escapeHtml(input.date)}, then becomes read-only. Nothing is deleted.</p>`,
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}

/** A2(b) — billing.plan_kept: team Admin notice when payer resumes plan. */
export function planKeptEmail(): RenderedEmail {
  const subject = 'Plan kept';
  const greetingLine = greeting(null);
  const text = textEmail([
    greetingLine,
    "This team's plan was kept. Nothing changes.",
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const html = htmlShell(subject, [
    escapeHtml(greetingLine),
    "<p>This team's plan was kept. Nothing changes.</p>",
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}

/** A2(c) — billing.plan_ended: team Admin notice when plan ends / read-only. */
export function planEndedEmail(): RenderedEmail {
  const subject = 'Plan ended';
  const greetingLine = greeting(null);
  const text = textEmail([
    greetingLine,
    'This team is now read-only because its plan ended. Nothing is deleted. It unlocks when the plan is subscribed again.',
    AUTO_FOOTER,
    'The Rowta team',
  ]);
  const html = htmlShell(subject, [
    escapeHtml(greetingLine),
    '<p>This team is now read-only because its plan ended. Nothing is deleted. It unlocks when the plan is subscribed again.</p>',
    escapeHtml(AUTO_FOOTER),
    'The Rowta team',
  ]);
  return { subject, text, html };
}


