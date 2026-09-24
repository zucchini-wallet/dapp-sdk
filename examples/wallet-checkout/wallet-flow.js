// Connection never creates an invoice or requests a payment.
export function createWalletFlow(provider, createClient) {
 let client;
 return {
  async connect() {
   await provider.connect(['send_transaction']);
   const next=createClient(provider);
   const capabilities=await next.capabilities();
   if(!capabilities.networks.includes('testnet'))throw new Error('Switch your wallet to testnet.');
   client=next;
  },
  async pay(invoice) {
   if(!client)throw new Error('Connect your wallet first.');
   return client.checkout('testnet',invoice);
  }
 };
}
