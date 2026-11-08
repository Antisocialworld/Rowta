// Shared webhook constants (FIX-B, Task 4/6).
// Event names and the signature header are defined here once and used by both the simulator
// and the webhook handler. [VERIFY against provider docs before using real provider keys.]

export const WEBHOOK_SIGNATURE_HEADER = 'verif-hash';

// Provider event types that trigger a payment job. Every other type is recorded as 'ignored'
// and acknowledged, never acted on.
export const PAYMENT_EVENT_TYPES = ['charge.completed'] as const;

export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];

export function isPaymentEvent(eventType: string): eventType is PaymentEventType {
  return PAYMENT_EVENT_TYPES.includes(eventType as PaymentEventType);
}
