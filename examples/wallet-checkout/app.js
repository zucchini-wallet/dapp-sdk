import { createMerchantPaymentClient } from './sdk.js';
import { createWalletFlow } from './wallet-flow.js';
const pay=document.querySelector('#pay'),check=document.querySelector('#check'),status=document.querySelector('#status');
const native=document.querySelector('#native'),nativeLink=document.querySelector('#native-link'),newOrder=document.querySelector('#new-order');
let order,flow,connected=false,busy=false,phase='',issued=false;
async function api(path,body) {
 const response=await fetch(`/merchant-test/api/${path}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
 const data=await response.json();if(!response.ok)throw new Error(data.error??'Checkout unavailable.');return data;
}
function render(){
 const receipt=order?.receipt,started=issued||order?.state!=='created';
 document.querySelector('#recipient').textContent=order?`Recipient: ${order.recipient}`:'';
 document.querySelector('#reference').textContent=order?`Order: ${order.id}`:'';
 document.querySelector('#txid').textContent=order?.txid?`Submitted transaction: ${order.txid}`:'';
 pay.hidden=Boolean(started&&!busy);pay.disabled=busy||!order||started;
 pay.textContent=busy?(phase==='connecting'?'Connecting…':phase==='invoice'?'Preparing payment…':'Payment in progress…'):connected?'Confirm payment · 0.001 ZEC':'Connect wallet';
 native.hidden=Boolean(started||connected);native.disabled=busy||!order;
 check.hidden=!started||busy;newOrder.disabled=busy;
 document.querySelector('#payment-note').textContent=started?'Receipt status updates automatically. You do not need to send another payment.':'Connecting does not send funds. You will review the network fee and approve the payment in your wallet.';
 const labels={paid:'Payment confirmed. Thank you.',detected:'Payment received. Waiting for confirmation.',confirming:`Payment received · ${receipt?.confirmations}/${receipt?.requiredConfirmations} confirmations.`,underpaid:'The received amount is below the invoice total. Contact the merchant.',overpaid:'An extra payment amount was detected. Contact the merchant.',late_payment:'Payment arrived after the invoice expired. The merchant needs to review it.',reorg_review:'Payment confirmation changed. The merchant needs to review it.',expired:'This invoice expired. Check wallet Activity before starting another order.'};
 if(busy){status.textContent=phase==='connecting'?'Approve the connection in Zucchini. No payment is requested yet.':phase==='invoice'?'Preparing your test invoice…':phase==='submitted'?'Payment sent. Updating your order…':'Complete the payment in Zucchini. Preparing a private transaction can take a little time after approval.';return;}
 status.textContent=labels[receipt?.state]??(order?.txid?'Payment sent. Waiting for the merchant to detect the receipt.':started?'Payment requested. Check wallet Activity and order status before trying again.':connected?'Wallet connected. Confirm when you are ready to pay.':'Connect your wallet to continue.');
}
async function refresh(){order=await api('order');render();}
pay.addEventListener('click',async()=>{
 if(busy||issued||order?.state!=='created')return;
 busy=true;phase=connected?'invoice':'connecting';render();
 try{
  if(!connected){
   if(!window.zucchini)throw new Error('Open this page with the testing extension enabled, then refresh.');
   flow=createWalletFlow(window.zucchini,createMerchantPaymentClient);
   await flow.connect();connected=true;
  }else{
   const result=await flow.pay(async challenge=>{
    const {invoice}=await api('invoice',{orderId:order.id,challenge:challenge.challenge});
    issued=true;phase='wallet';render();return invoice;
   });
   phase='submitted';render();
   // A wallet submission report is not proof of receipt.
   await api('submitted',{orderId:order.id,txid:result.txid});
   order=await api('order');
  }
  busy=false;render();
 }catch(error){
  // Re-read the durable order before enabling any retry after an uncertain response.
  try{order=await api('order');}catch{issued=true;}
  busy=false;render();status.textContent=error.message;
 }
});
check.addEventListener('click',()=>refresh().catch(e=>{status.textContent=e.message;}));
native.addEventListener('click',async()=>{
 if(busy||issued||order?.state!=='created')return;
 busy=true;phase='invoice';render();
 try{
  const {invoice}=await api('native-invoice',{orderId:order.id});issued=true;
  nativeLink.href='zucchini.testing://merchant?invoice='+encodeURIComponent(invoice);nativeLink.hidden=false;
  busy=false;render();status.textContent='Open Zucchini Testing to review and approve your payment.';
 }catch(error){try{order=await api('order');}catch{issued=true;}busy=false;render();status.textContent=error.message;}
});
newOrder.addEventListener('click',async()=>{
 if(busy||!confirm('Start a separate test purchase? This does not cancel a previous payment. Check wallet Activity before paying again.'))return;
 busy=true;newOrder.disabled=true;
 try{await api('new-order',{});issued=false;nativeLink.hidden=true;order=await api('order');busy=false;render();}
 catch(error){busy=false;render();status.textContent=error.message;}
});
refresh().catch(e=>{status.textContent=e.message;});
setInterval(()=>{if(order&&!busy&&(issued||order.state!=='created')&&!document.hidden)refresh().catch(()=>{status.textContent='Receipt status unavailable. No payment will be retried.';});},15000);
