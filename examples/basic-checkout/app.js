import {createZucchiniClient,discoverZucchiniProvider} from '@zucchinifi/dapp-sdk/zcash';
const $=id=>document.getElementById(id);
let client, ready=false, uncertain=sessionStorage.getItem("zucchini-example-pending") === "yes", subscriptions=[];
const status=text=>{$('status').textContent=text;};
if(uncertain)status('A previous payment may have been submitted. Check wallet Activity before using a new checkout tab.');
function reset(){ready=false;$('pay').disabled=true;$('disconnect').disabled=true;$('network').textContent='';}
$('connect').onclick=async()=>{
 $('connect').disabled=true;
 try{
  const provider=discoverZucchiniProvider();if(!provider)throw Error('Install or enable Zucchini Wallet for this site, then reload.');
  subscriptions.forEach(stop=>stop());subscriptions=[];
  client=createZucchiniClient(provider);
  const connection=await client.connect({permissions:['send_transaction']});
  if(!connection.connected||!connection.approvedPermissions.includes('send_transaction'))throw Error('Payment permission was not granted.');
  const network=await client.network();$('network').textContent=`Network: ${network}`;
  if(network!=='testnet')throw Error('Switch your wallet to testnet before using this example.');
  ready=true;$('pay').disabled=uncertain;$('disconnect').disabled=false;
  subscriptions=[client.on('disconnect',reset),client.on('accountsChanged',reset)];
  status('Connected. No payment has been requested.');
 }catch(e){reset();status(e.message);}finally{$('connect').disabled=false;}
};
$('checkout').onsubmit=async event=>{
 event.preventDefault();if(!ready||uncertain)return;
 $('pay').disabled=true;
 try{
  const recipient=$('recipient').value.trim(),amount=$('amount').value.trim();
  if(!/^utest1[0-9a-z]+$/.test(recipient)||!/^\d+(\.\d{1,8})?$/.test(amount)||!/[1-9]/.test(amount))throw Error('Enter a testnet unified address and a positive amount with at most eight decimals.');
  if(await client.network()!=='testnet')throw Error('Network changed. Reconnect on testnet.');
  // Disable repeat submissions even if the page loses the wallet response.
  sessionStorage.setItem('zucchini-example-pending','yes');
  uncertain=true;
  const {txid}=await client.requestPayment(`zcash:${recipient}?amount=${amount}`);
  status(`Submitted: ${txid}\nThis is not confirmation of receipt. Check wallet Activity; do not pay again.`);
 }catch(e){status(`${e.message}${uncertain?'\nCheck wallet Activity before attempting another payment.':''}`);}
 finally{$('pay').disabled=uncertain||!ready;}
};
$('disconnect').onclick=async()=>{try{await client?.disconnect();reset();status('Disconnected.');}catch(e){status(e.message);}};
