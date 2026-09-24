import { signReceiptWebhook, type ReceiptStatus } from './merchant-receipts.js';
/** Persist with the order in the SAME storage transaction before acknowledging a receipt. */
export interface ReceiptWebhookEvent {
 id: string; sequence: number; type: 'payment.status_changed'; orderId: string; createdAt: number;
 receipt: ReceiptStatus; attempts: number; nextAttemptAt: number;
 deliveredAt?: number; failedAt?: number;
}
export function createReceiptWebhookEvent(orderId: string, receipt: ReceiptStatus, now = Math.floor(Date.now()/1000), sequence = 0): ReceiptWebhookEvent {
 if (!Number.isSafeInteger(sequence) || sequence < 0 || !/^[A-Za-z0-9_-]{1,128}$/.test(orderId) || !Number.isSafeInteger(now) || now < 0) throw new Error('Invalid webhook event');
 return { id: crypto.randomUUID(), sequence, type: 'payment.status_changed', orderId, createdAt: now, receipt: structuredClone(receipt), attempts: 0, nextAttemptAt: now };
}
/** One attempt, with a stable event ID. Persist returned state; schedule the next attempt.
 * If the process dies after delivery, replay is safe when receivers deduplicate by event ID.
 * endpoint/key are operator configuration, never values supplied by a checkout customer. */
export async function deliverReceiptWebhook(event: ReceiptWebhookEvent, config: { endpoint: string; key: Uint8Array; fetch?: typeof fetch; now?: number }): Promise<ReceiptWebhookEvent> {
 const now = config.now ?? Math.floor(Date.now()/1000);
 const endpoint = new URL(config.endpoint);
 if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash || config.key.length < 32) throw new Error('Invalid webhook configuration');
 if (event.deliveredAt !== undefined || event.failedAt !== undefined || now < event.nextAttemptAt) return event;
 const body = JSON.stringify({ id: event.id, sequence: event.sequence, type: event.type, orderId: event.orderId, createdAt: event.createdAt, receipt: event.receipt });
 const signature = await signReceiptWebhook(body, config.key, now);
 const next = { ...event, attempts: event.attempts + 1 };
 try {
  const response = await (config.fetch ?? fetch)(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', 'Zucchini-Signature': signature, 'Zucchini-Event-Id': event.id }, body });
  await response.body?.cancel();
  if (response.ok) return { ...next, deliveredAt: now };
 } catch { /* Record retry state without logging headers, keys or payment contents. */ }
 if (next.attempts >= 8) return { ...next, failedAt: now };
 return { ...next, nextAttemptAt: now + Math.min(3600, 15 * 2 ** (next.attempts - 1)) };
}
