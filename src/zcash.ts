/** Browser connection contract implemented by Zucchini Wallet 0.5.2. No key export. */
export type ZucchiniNetwork = "mainnet" | "testnet";
export type ZucchiniValuePool =
  | "transparent"
  | "sapling"
  | "orchard"
  | "ironwood";
export type ZucchiniPermission =
  | "view_addresses"
  | "view_balance"
  | "send_transaction";
export interface ConnectRequest {
  readonly permissions: readonly ZucchiniPermission[];
}
export interface Connection {
  readonly connected: boolean;
  readonly approvedPermissions: readonly ZucchiniPermission[];
  readonly accounts: readonly { name: string; address: string }[];
}
export interface TransactionRequest {
  readonly amountZatoshis: bigint;
  readonly memo?: string;
  readonly recipient: string;
}
export interface ZucchiniAddresses {
  readonly unified: string;
  /** The provider currently exposes its Unified Address for the Orchard alias. */
  readonly orchard: string;
  readonly sapling: string;
  readonly transparent: string;
}
export interface PaymentRequestOptions {
  /** Latest wallet approval time in integer Unix seconds. Does not authenticate a quote. */
  readonly expiresAt?: number;
}
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
  const candidate = (window as unknown as { zucchini?: ZucchiniProvider })
    .zucchini;
  return candidate &&
    typeof candidate.request === "function" &&
    typeof candidate.connect === "function" &&
    typeof candidate.disconnect === "function"
    ? candidate
    : undefined;
}
/** Never retries a payment automatically. Wallet errors retain their original code. */
export function createZucchiniClient(provider: ZucchiniProvider) {
  return {
    connect(request: ConnectRequest = { permissions: [] }) {
      if (
        !Array.isArray(request.permissions) ||
        request.permissions.some(
          (p) =>
            !["view_addresses", "view_balance", "send_transaction"].includes(p),
        )
      )
        throw new Error("Unsupported wallet permission");
      return provider.connect([...new Set(request.permissions)]);
    },
    disconnect: () => provider.disconnect(),
    /** Ordinary, unsigned ZIP-321 request. Parsing and approval happen inside the wallet.
     * Never falls back from a rejected signed invoice or retries a payment.
     */
    async requestPayment(
      uri: string,
      options: PaymentRequestOptions = {},
    ): Promise<{ txid: string }> {
      if (
        typeof uri !== "string" ||
        uri.length > 16384 ||
        !/^zcash:/i.test(uri)
      )
        throw new Error("Invalid ZIP-321 payment URI");
      if (
        !options ||
        typeof options !== "object" ||
        Array.isArray(options) ||
        Object.keys(options).some((key) => key !== "expiresAt")
      )
        throw new Error("Invalid payment request options");
      const expiresAt = options.expiresAt;
      if (
        expiresAt !== undefined &&
        (!Number.isSafeInteger(expiresAt) ||
          expiresAt <= Math.floor(Date.now() / 1000) ||
          expiresAt > Math.floor(Number.MAX_SAFE_INTEGER / 1000))
      )
        throw new Error("Payment approval deadline is invalid or expired");
      const result = (await provider.request({
        method: "zcash_requestPayment",
        params: { uri, ...(expiresAt === undefined ? {} : { expiresAt }) },
      })) as unknown;
      if (typeof result !== "string" || !/^[a-f0-9]{64}$/i.test(result))
        throw new Error(
          "Submission response is uncertain. Check wallet activity before retrying.",
        );
      return { txid: result };
    },
    async network(): Promise<ZucchiniNetwork> {
      const result = (await provider.request({ method: "getNetwork" })) as {
        network?: unknown;
      } | null;
      if (result?.network === "main") return "mainnet";
      if (result?.network === "test") return "testnet";
      throw new Error("Invalid wallet network response");
    },
    /** Requires an explicitly approved view_addresses grant; never connects or escalates consent. */
    async getAddresses(): Promise<ZucchiniAddresses> {
      const result = (await provider.request({
        method: "getAddresses",
      })) as Record<string, unknown> | null;
      const keys = ["unified", "orchard", "sapling", "transparent"] as const;
      if (
        !result ||
        typeof result !== "object" ||
        Array.isArray(result) ||
        keys.some(
          (key) =>
            typeof result[key] !== "string" ||
            (result[key] as string).length > 1600 ||
            !/^[A-Za-z0-9]+$/.test(result[key] as string),
        )
      )
        throw new Error("Invalid wallet address response");
      return Object.freeze({
        unified: result.unified as string,
        orchard: result.orchard as string,
        sapling: result.sapling as string,
        transparent: result.transparent as string,
      });
    },
    async requestTransaction(
      request: TransactionRequest,
    ): Promise<{ txid: string }> {
      const value = request.amountZatoshis;
      if (
        typeof value !== "bigint" ||
        value <= 0n ||
        value > 2100000000000000n ||
        typeof request.recipient !== "string" ||
        !request.recipient ||
        request.recipient.length > 1024 ||
        (request.memo !== undefined &&
          (typeof request.memo !== "string" ||
            new TextEncoder().encode(request.memo).length > 512))
      )
        throw new Error("Invalid payment request");
      const amount = `${value / 100000000n}.${(value % 100000000n).toString().padStart(8, "0")}`;
      const result = (await provider.request({
        method: "sendTransaction",
        params: {
          to: request.recipient,
          amount,
          ...(request.memo === undefined ? {} : { memo: request.memo }),
        },
      })) as unknown;
      if (typeof result !== "string" || !/^[a-f0-9]{64}$/i.test(result))
        throw new Error(
          "Submission response is uncertain. Check wallet activity before retrying.",
        );
      return { txid: result };
    },
    on(
      event: "disconnect" | "accountsChanged",
      listener: (value: unknown) => void,
    ) {
      provider.on?.(event, listener);
      return () => provider.off?.(event, listener);
    },
  };
}
