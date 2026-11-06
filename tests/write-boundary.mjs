import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server.js";
import { load } from "./helpers/load-typescript.mjs";
const validation=load('lib/write-validation.ts');
let user={id:'test-user'},rpcError=null,lastCall=null,calls=0;
const {POST}=load('app/api/write/[action]/route.ts',{
   '@/lib/write-validation':validation,
   '@/lib/supabase-server':{createClient:async()=>({
    auth:{getUser:async()=>({data:{user},error:null})},
    from:()=>{const chain={select:()=>chain,eq:()=>chain,in:()=>chain,single:async()=>({data:{id:'account-id'},error:null}),maybeSingle:async()=>({data:null,error:null})};return chain;},
    rpc:async(name,args)=>{calls++;lastCall={name,args};return {data:{order_id:7},error:rpcError}},
 })},
});
const base={items:[{offer_id:12,quantity:1}],coupon:null,address:{full_name:'Buyer Name'},key:'10000000-0000-0000-0000-000000000001',expected_total:150000};
const walletBase={order_id:7,allocations:[{account_code:'store',amount:150000}],key:'30000000-0000-0000-0000-000000000001'};
const refundBase={order_id:7,reason:'Test refund',key:'50000000-0000-0000-0000-000000000001'};
const creditBase={user_id:'00000000-0000-0000-0000-000000000002',amount:200000,reason:'Manual test credit',reference:'CREDIT-001',key:'70000000-0000-0000-0000-000000000001'};
const rescueBase={user_id:creditBase.user_id,amount:100000,reference:'RESCUE-001',key:'80000000-0000-0000-0000-000000000001'};
function request(action,body,origin='https://mycar.test',type='application/json'){
 return POST(new Request('https://mycar.test/api/write/'+action,{method:'POST',headers:{origin,'content-type':type},body:typeof body==='string'?body:JSON.stringify(body)}),{params:Promise.resolve({action})});
}
(async()=>{
 let passed=0;
 const status=async(p,n)=>{assert.equal((await p).status,n);passed++};
 await status(request('checkout',base,'https://attacker.test'),403);
 await status(request('checkout',base,'null'),403);
 await status(request('checkout',base,'https://mycar.test','text/plain'),415);
 user=null;await status(request('checkout',base),401);user={id:'test-user'};
 await status(request('admin',{role:'admin'}),400);
 for (const action of ['constructor','__proto__','toString']) await status(request(action,{}),400);
 await status(request('checkout',{...base,user_id:'other-user'}),400);
 await status(request('checkout',{...base,total_price:1}),400);
 await status(request('checkout',{...base,items:[{offer_id:12,quantity:1,price:1}]}),400);
 await status(request('checkout',{...base,items:[{offer_id:12,quantity:0}]}),400);
 await status(request('checkout',{...base,items:[{offer_id:12,quantity:1},{offer_id:12,quantity:1}]}),400);
 await status(request('checkout',{...base,key:'not-a-key'}),400);
  await status(request('checkout',{...base,expected_total:-1}),400);
  await status(request('wallet_pay',{...walletBase,allocations:[]}),400);
  await status(request('wallet_pay',{...walletBase,allocations:[{account_code:'store',amount:0}]}),400);
  await status(request('wallet_pay',{...walletBase,allocations:[{account_code:'store',amount:1,extra:true}]}),400);
  await status(request('wallet_pay',{...walletBase,key:'not-a-key'}),400);
 await status(request('checkout','{'),400);
 await status(request('checkout',' '.repeat(17000)),413);
 await status(request('offer',{product_id:1,price:10,stock:1,hidden:false,seller_id:'other-user'}),400);
 await status(request('fulfillment',{order_id:1,status:'paid'}),400);
 assert.equal(calls,0);passed++;
  await status(request('checkout',base),200);
  assert.equal(lastCall.name,'place_order');assert.equal(lastCall.args.p_expected_total,150000);assert.equal('user_id' in lastCall.args,false);passed++;
  await status(request('wallet_pay',walletBase),200);
   assert.equal(lastCall.name,'pay_order_from_wallet');assert.deepEqual(lastCall.args,{p_order_id:7,p_key:walletBase.key});passed++;
  await status(request('wallet_refund',{...refundBase,reason:''}),400);
  await status(request('wallet_refund',{...refundBase,key:'not-a-key'}),400);
  await status(request('wallet_refund',refundBase),200);
   assert.equal(lastCall.name,'admin_refund_order_escrow');assert.deepEqual(lastCall.args,{p_order_id:7,p_reason:'Test refund',p_refund_transfer_id:null});passed++;
  await status(request('manual_credit',{...creditBase,amount:0}),400);
  await status(request('manual_credit',creditBase),200);
   assert.equal(lastCall.name,'admin_manual_wallet_entry');assert.deepEqual(lastCall.args,{p_account_id:'account-id',p_direction:'charge',p_amount_toman:creditBase.amount,p_reason:creditBase.reason,p_tracking_reference:creditBase.reference});passed++;
  await status(request('test_rescue',{...rescueBase,amount:0}),400);
  await status(request('test_rescue',rescueBase),200);
  assert.equal(lastCall.name,'admin_create_test_rescue_transaction');assert.deepEqual(lastCall.args,{p_user_id:rescueBase.user_id,p_amount:rescueBase.amount,p_reference:rescueBase.reference,p_idempotency_key:rescueBase.key});passed++;
  await status(request('test_rescue_release',{transaction_id:12}),200);
  assert.equal(lastCall.name,'admin_release_test_rescue_transaction');assert.deepEqual(lastCall.args,{p_transaction_id:12});passed++;
  await status(request('test_rescue_refund',{transaction_id:12,reason:'Test refund',key:refundBase.key}),200);
  assert.equal(lastCall.name,'admin_refund_test_rescue_transaction');assert.deepEqual(lastCall.args,{p_transaction_id:12,p_reason:'Test refund',p_idempotency_key:refundBase.key});passed++;
 rpcError={message:'internal_database_details_should_never_leak'};
 const failed=await request('checkout',base);
 assert.equal(failed.status,409);assert.equal((await failed.text()).includes(rpcError.message),false);passed++;
 assert.equal(failed.headers.get('cache-control'),'no-store');passed++;
 const {refreshSession}=load('lib/session-proxy.ts',{
  'next/server':{NextResponse},
  '@supabase/ssr':{createServerClient:(_url,_key,{cookies})=>({auth:{getUser:async()=>{
   cookies.setAll([{name:'test-session-a',value:'first',options:{path:'/'}}],{'Cache-Control':'private, no-store','Pragma':'no-cache','Expires':'0'});
   cookies.setAll([{name:'test-session-b',value:'second',options:{path:'/'}}],{});
   return {data:{user},error:null};
  }}})},
 });
 const refreshed=await refreshSession(new NextRequest('https://mycar.test/shop'));
 assert.equal(refreshed.cookies.get('test-session-a').value,'first');passed++;
 assert.equal(refreshed.cookies.get('test-session-b').value,'second');passed++;
 assert.equal(refreshed.headers.get('cache-control'),'private, no-store');passed++;
 assert.equal(refreshed.headers.get('pragma'),'no-cache');passed++;
 user=null;
 const redirected=await refreshSession(new NextRequest('https://mycar.test/admin'));
 assert.equal(redirected.status,307);passed++;
 assert.equal(redirected.cookies.get('test-session-a').value,'first');passed++;
 assert.equal(redirected.headers.get('cache-control'),'private, no-store');passed++;
 console.log(`${passed} HTTP boundary assertions passed.`);
})().catch(e=>{console.error(e);process.exitCode=1});
