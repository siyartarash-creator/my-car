import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server.js";
import { load } from "./helpers/load-typescript.mjs";
const validation=load('lib/write-validation.ts');
let user={id:'test-user'},rpcError=null,lastCall=null,calls=0;
const {POST}=load('app/api/write/[action]/route.ts',{
 '@/lib/write-validation':validation,
 '@/lib/supabase-server':{createClient:async()=>({
  auth:{getUser:async()=>({data:{user},error:null})},
  rpc:async(name,args)=>{calls++;lastCall={name,args};return {data:{order_id:7},error:rpcError}},
 })},
});
const base={items:[{offer_id:12,quantity:1}],coupon:null,address:{full_name:'Buyer Name'},key:'10000000-0000-0000-0000-000000000001',expected_total:150000};
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
 await status(request('checkout','{'),400);
 await status(request('checkout',' '.repeat(17000)),413);
 await status(request('offer',{product_id:1,price:10,stock:1,hidden:false,seller_id:'other-user'}),400);
 await status(request('fulfillment',{order_id:1,status:'paid'}),400);
 assert.equal(calls,0);passed++;
 await status(request('checkout',base),200);
 assert.equal(lastCall.name,'place_order');assert.equal(lastCall.args.p_expected_total,150000);assert.equal('user_id' in lastCall.args,false);passed++;
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
 // Server Actions must bypass the cookie-rewrite dance entirely (Netlify
 // Edge Functions regression: that rewrite corrupted the Server Action's
 // response, surfacing as "An unexpected response was received from the
 // server" with the action never completing). Prove it never even touches
 // Supabase for such a request.
 let supabaseTouched=false;
 const {refreshSession:refreshSessionStrict}=load('lib/session-proxy.ts',{
  'next/server':{NextResponse},
  '@supabase/ssr':{createServerClient:()=>{supabaseTouched=true;throw new Error('must not be called for a Server Action request');}},
 });
 const actionReq=new NextRequest('https://mycar.test/automotive/teach',{headers:{'next-action':'abcdef'}});
 const bypassed=await refreshSessionStrict(actionReq);
 assert.equal(supabaseTouched,false);passed++;
 assert.equal(bypassed.cookies.getAll().length,0);passed++;
 console.log(`${passed} HTTP boundary assertions passed.`);
})().catch(e=>{console.error(e);process.exitCode=1});
