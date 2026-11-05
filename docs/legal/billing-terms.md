> **DRAFT — not legal advice.** Review by a qualified lawyer before launch.

# Billing Terms

Draft written 20 October 2026. These billing terms are a draft until a qualified lawyer reviews them.

## The short version

Rowta is a paid subscription priced by plan and seats. Payments run in the provider's **test mode today**, so no real money moves. Plan changes are prorated. A missed renewal gets a 7-day grace period, after which the team is restricted — but members can still read shifts.

## Plans and seats

Prices are exact amounts charged monthly. The list prices below are the USD prices from Rowta's price plan; the currency you pay in comes from the country you choose at sign-up, using Rowta's fixed price table for that currency — there is no exchange-rate conversion.

| Plan | Price per month (USD list) | Seats included | Extra seat |
|---|---|---|---|
| Starter | 2000 cents (20.00) | up to 5 | not available; hard cap of 5 seats |
| Team | 5000 cents (50.00) | up to 15 | 300 cents (3.00) per month |
| Business | 12000 cents (120.00) | up to 40 | 200 cents (2.00) per month |

- A **seat** is an active team member who is not the owner. The owner never counts as a seat.
- A pending invite becomes a billable seat only when it is accepted.
- On Starter the team stops issuing invites once members plus pending invites reach 5.
- Team and Business have a sanity ceiling of 200 seats.

## Changing plan or seats mid-period

Rowta counts the days left in your 30-day period and charges only the share for those days:

- **Upgrading** (a higher plan or more seats) charges the prorated difference today, then the full new price at the next renewal.
- **Adding seats** inside your included seats costs nothing extra today; seats above the included amount are prorated today.
- **Downgrading or removing seats** takes effect at the end of the period. You pay nothing extra today; the new price applies at renewal.
- Amounts are rounded down to the smallest unit of your currency.
- A downgrade that would leave more members than the plan allows is refused until the owner removes members.

The exact arithmetic is fixed by a formula with worked examples in Rowta's internal documentation; the values above follow it.

## Renewal, grace period and the restricted state

- Subscriptions renew each period. Rowta plans to charge automatically at renewal; if a charge fails, an email may ask the owner to pay — [DECISION: the renewal mechanism is still open (automatic charge vs emailed pay link) in Rowta's plan].
- A failed renewal moves the subscription to **past due** and starts a **7-day grace period**. The owner is notified on day 0, day 3 and day 6.
- After the grace period the team becomes **restricted**: members can still view shifts, but nobody can create or edit shifts, invite people, or approve swaps, until the subscription is paid.
- Deleting a team cancels its subscription at the end of the period with no refund.

## Refunds

Deleting a team does not refund the current period. Rowta has no other refund rule yet: [OWNER DECISION: refund policy — none is defined in the product plan; your lawyer and the consumer law of your launch market must set one before real payments].

## Taxes

Prices are treated as the amount you pay. Rowta issues a payment receipt — not a tax invoice — and does not calculate or add VAT, and holds no tax identification number. This is Rowta's current design position, recorded in its internal tax notes; it is not tax advice. Whether that is correct for your situation is a question for a qualified tax adviser: [OWNER: confirm before taking real money].

## Payments today are test mode

The payment provider is configured in **test mode** (`PAYMENT_MODE=test` in the environment). Test payments use test cards and move no money. The development-only payment simulator exists for local testing and refuses to run in production.

## App store billing rules

Rowta sells a digital subscription for using the app. Apple's and Google's in-app purchase rules could affect how that is sold in production. Rowta's repository README keeps this note open until it is written from the current official policies — that write-up is planned before launch. Rowta keeps an internal Google Play compliance checklist for this (in its repository, written before launch). [OWNER: confirm whether your launch sells through the stores or on the web.]

## Questions

Email [rowtareply@gmail.com](mailto:rowtareply@gmail.com). See also the [Privacy policy](/privacy/) and [Terms of Service](/terms/).
