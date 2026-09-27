export interface ScannerConfig {
 binary: string;
 viewingKeyFile: string;
 endpoint: string;
 network: 'mainnet' | 'testnet';
 timeoutMs?: number;
}
export interface ScanRequest { from: number; limit?: number; recipients: readonly string[]; signal?: AbortSignal }
export interface Receipt { txid: string; pool: 'sapling' | 'orchard' | 'ironwood'; outputIndex: number; recipient: string; amountZatoshis: string; memo: string; blockHeight: number }
export interface ScanBatch { network: 'mainnet' | 'testnet'; tipHeight: number; tipHash: string; anchorHash: string; blocks: {height: number; hash: string; previousHash: string; receipts: Receipt[]}[] }
/** Stateless backend scanner. Caller owns checkpoints, reorg handling and fulfillment policy. */
export declare function createReceiptScanner(config: ScannerConfig): {scan(request: ScanRequest): Promise<ScanBatch>};
