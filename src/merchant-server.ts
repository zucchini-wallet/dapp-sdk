/** Backend-only merchant invoice signing. Keep signing credentials off the page. */
export { signInvoice, signRegistrationProof } from '@zucchinifi/merchant-payments/server';
export type { Signer } from '@zucchinifi/merchant-payments/server';
export type { Invoice, RegistrationProof, AddressValidator } from '@zucchinifi/merchant-payments';
