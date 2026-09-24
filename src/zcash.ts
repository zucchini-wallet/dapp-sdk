/** Browser connection contract implemented by Zucchini Wallet 0.5.2. No key export. */
export type ZucchiniNetwork = "mainnet" | "testnet";
export type ZucchiniValuePool = "transparent" | "sapling" | "orchard" | "ironwood";
export type ZucchiniPermission = "view_addresses" | "view_balance" | "send_transaction";
export interface ConnectRequest { readonly permissions: readonly ZucchiniPermission[] }
export interface Connection {
 readonly connected: boolean;
 readonly approvedPermissions: readonly ZucchiniPermission[];
 readonly accounts: readonly { name: string; address: string }[];
}
export interface TransactionRequest { readonly amountZatoshis: bigint; readonly memo?: string; readonly recipient: string }
export interface ZucchiniProvider {
 request(args: { method: string; params?: unknown }): Promise<unknown>;
 connect(permissions?: readonly ZucchiniPermission[]): Promise<Connection>;
 disconnect(): Promise<unknown>;
 on?(event: string, listener: (value: unknown) => void): void;
 off?(event: string, listener: (value: unknown) => void): void;
}
/** Safe during SSR; absence is a normal discovery result. */
export function discoverZucchiniProvider(): ZucchiniProvider | undefined {
 if (typeof window === "undefined") return undefined;
 const candidate = (window as unknown as { zucchini?: ZucchiniProvider }).zucchini;
 return candidate && typeof candidate.request === "function" && typeof candidate.connect === "function" && typeof candidate.disconnect === "function" ? candidate : undefined;
}
/** Never retries a payment automatically. Wallet errors retain their original code. */
export function createZucchiniClient(provider: ZucchiniProvider) {
 return {
  connect(request: ConnectRequest = { permissions: [] }) {
   if (!Array.isArray(request.permissions) || request.permissions.some(p => !["view_addresses", "view_balance", "send_transaction"].includes(p))) throw new Error("Unsupported wallet permission");
   return provider.connect([...new Set(request.permissions)]);
  },
  disconnect: () => provider.disconnect(),
  /** Ordinary, unsigned ZIP-321 request. Parsing and approval happen inside the wallet.
   * Never falls back from a rejected signed invoice or retries a payment.
   */
  async requestPayment(uri: string): Promise<{ txid: string }> {
   if (typeof uri !== "string" || uri.length > 16384 || !/^zcash:/i.test(uri)) throw new Error("Invalid ZIP-321 payment URI");
   const result = await provider.request({ method: "zcash_requestPayment", params: { uri } }) as unknown;
   if (typeof result !== "string" || !/^[a-f0-9]{64}$/i.test(result)) throw new Error("Submission response is uncertain. Check wallet activity before retrying.");
   return { txid: result };
  },
  async network(): Promise<ZucchiniNetwork> {
   const result = await provider.request({ method: "getNetwork" }) as { network?: unknown } | null;
   if (result?.network === "main") return "mainnet";
   if (result?.network === "test") return "testnet";
   throw new Error("Invalid wallet network response");
  },
  async requestTransaction(request: TransactionRequest): Promise<{ txid: string }> {
   const value = request.amountZatoshis;
   if (typeof value !== "bigint" || value <= 0n || value > 2100000000000000n || typeof request.recipient !== "string" || !request.recipient || request.recipient.length > 1024 || (request.memo !== undefined && (typeof request.memo !== "string" || new TextEncoder().encode(request.memo).length > 512))) throw new Error("Invalid payment request");
   const amount = `${value / 100000000n}.${(value % 100000000n).toString().padStart(8,"0")}`;
   const result = await provider.request({ method: "sendTransaction", params: { to: request.recipient, amount, ...(request.memo === undefined ? {} : { memo: request.memo }) } }) as unknown;
   if (typeof result !== "string" || !/^[a-f0-9]{64}$/i.test(result)) throw new Error("Submission response is uncertain. Check wallet activity before retrying.");
   return { txid: result };
  },
  on(event: "disconnect" | "accountsChanged", listener: (value: unknown) => void) {
   provider.on?.(event, listener); return () => provider.off?.(event, listener);
  },
 };
}
