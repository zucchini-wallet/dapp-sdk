export type ZucchiniNetwork = "mainnet" | "testnet";
export type ZucchiniValuePool = "transparent" | "sapling" | "orchard" | "ironwood";

export type ZucchiniPermission =
  | "request_transaction"
  | "view_address"
  | "view_balance"
  | "view_network"
  | "view_viewing_key";

export interface ConnectRequest {
  readonly permissions: readonly ZucchiniPermission[];
}

export interface Connection {
  readonly origin: string;
  readonly permissions: readonly ZucchiniPermission[];
}

export interface TransactionRequest {
  readonly amountZatoshis: bigint;
  readonly memo?: string;
  readonly recipient: string;
}

export interface ZucchiniProvider {
  connect(request: ConnectRequest): Promise<Connection>;
  disconnect(): Promise<void>;
  network(): Promise<ZucchiniNetwork>;
  requestTransaction(request: TransactionRequest): Promise<{ readonly txid: string }>;
}
