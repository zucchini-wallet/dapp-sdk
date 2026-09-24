/** Experimental open merchant payment bridge. No automatic unsigned fallback. */
export { verifyInvoice, verifyRegistry, verifyRegistrationProof, assertCheckpoint, parsePaymentUri, ProtocolError } from '@zucchinifi/merchant-payments';
export type { Invoice, Merchant, RegistryPayload, VerifiedInvoice, VerifiedRegistry, AddressValidator } from '@zucchinifi/merchant-payments';
import type { Network } from '@zucchinifi/merchant-payments';

export interface MerchantPaymentProvider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}
export interface MerchantCapabilities {
  versions: readonly [1];
  networks: readonly Network[];
  features: readonly ['single-shielded-zec'];
}
export interface MerchantChallenge { challenge: string; origin: string; network: Network; expiresAt: number }
export interface MerchantPaymentResult { txid: string; invoiceDigest: string }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function bad(message: string): never { throw new Error(message); }
export function createMerchantPaymentClient(provider: MerchantPaymentProvider) {
  return {
    /** Call from checkout after connection. Backend must derive price/recipient from its order. */
    async checkout(network: Network, createInvoice: (challenge: MerchantChallenge) => Promise<string>): Promise<MerchantPaymentResult> {
      const challenge = await this.challenge(network);
      const invoice = await createInvoice(challenge);
      if (challenge.expiresAt <= Math.floor(Date.now() / 1000)) bad('Checkout expired before payment approval. Start checkout again. No payment was requested.');
      return this.requestPayment(invoice);
    },
    async capabilities(): Promise<MerchantCapabilities> {
      const value = await provider.request({ method: 'zcash_getMerchantPaymentCapabilities' });
      if (!object(value) || !Array.isArray(value.versions) || !value.versions.includes(1) ||
        !Array.isArray(value.networks) || value.networks.length === 0 || !value.networks.every(n => n === 'mainnet' || n === 'testnet') ||
        !Array.isArray(value.features) || !value.features.includes('single-shielded-zec')) bad('Wallet does not support verified merchant payments v1.');
      return { versions: [1], networks: value.networks as Network[], features: ['single-shielded-zec'] };
    },
    async challenge(network: Network): Promise<MerchantChallenge> {
      if (network !== 'mainnet' && network !== 'testnet') bad('Unsupported Zcash network.');
      if (typeof window === 'undefined' || window.location.protocol !== 'https:') bad('Merchant connections require HTTPS.');
      const value = await provider.request({ method: 'zcash_createMerchantPaymentChallenge', params: { version: 1, network } });
      const now = Math.floor(Date.now() / 1000);
      if (!object(value) || typeof value.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.challenge) ||
        value.origin !== window.location.origin || value.network !== network || typeof value.expiresAt !== 'number' ||
        !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + 900) bad('Invalid wallet payment challenge.');
      return value as unknown as MerchantChallenge;
    },
    async requestPayment(invoice: string): Promise<MerchantPaymentResult> {
      if (typeof invoice !== 'string' || invoice.length > 32768 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(invoice)) bad('Invalid signed invoice.');
      // Exactly one request. Failure/timeout must never trigger a second send or
      // downgrade to legacy sendTransaction. Recovery belongs to the wallet.
      const value = await provider.request({ method: 'zcash_requestMerchantPayment', params: { version: 1, invoice } });
      if (!object(value) || typeof value.txid !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value.txid) ||
        typeof value.invoiceDigest !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.invoiceDigest)) bad('Invalid wallet response; check wallet activity before retrying.');
      return { txid: value.txid, invoiceDigest: value.invoiceDigest };
    },
  };
}
