export type ZucchiniNetwork = "mainnet" | "testnet";
export type ZucchiniValuePool = "transparent" | "sapling" | "orchard" | "ironwood";

export type ZucchiniPermission =
  | "request_transaction"
  | "view_address"
  | "view_balance"
  | "view_network"
  | "view_viewing_key";

export interface ConnectRequest {
  permissions: readonly ZucchiniPermission[];
}

export interface Connection {
  origin: string;
  permissions: readonly ZucchiniPermission[];
}

export interface TransactionRequest {
  amountZatoshis: bigint;
  memo?: string;
  recipient: string;
}

export interface ZucchiniProvider {
  connect(request: ConnectRequest): Promise<Connection>;
  disconnect(): Promise<void>;
  network(): Promise<ZucchiniNetwork>;
  requestTransaction(request: TransactionRequest): Promise<{ txid: string }>;
}

