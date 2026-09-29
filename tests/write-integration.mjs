import assert from 'node:assert/strict';
import { load } from './helpers/load-typescript.mjs';
export async function testWriteIntegration(db,buyer,seller,other) {
 let uid=buyer;
 const {POST}=load('app/api/write/[action]/route.ts',{
  '@/lib/write-validation':load('lib/write-validation.ts'),
  '@/lib/supabase-server':{createClient:async()=>({
   auth:{getUser:async()=>({data:{user:uid?{id:uid}:null},error:null})},
   rpc:async(name,args)=>{
    assert.match(name,/^[a-z_]+$/);
    const keys=Object.keys(args); keys.forEach(key=>assert.match(key,/^p_[a-z_]+$/));
    await db.exec('set role authenticated');
    try {
     await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
     const values=keys.map(k=>args[k]!==null&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]);
     const bindings=keys.map((k,i)=>`${k} => $${i+1}`).join(',');
     const result=await db.query(`select public.${name}(${bindings}) as result`,values);
     return {data:result.rows[0].result,error:null};
    } catch(error) { return {data:null,error:{message:error.message}}; }
    finally { await db.exec('reset role'); }
   },
  })},
 });
 let passed=0;
 async function request(action,payload,status=200) {
  const response=await POST(new Request('https://mycar.test/api/write/'+action,{method:'POST',headers:{origin:'https://mycar.test','content-type':'application/json'},body:JSON.stringify(payload)}),{params:Promise.resolve({action})});
  assert.equal(response.status,status,action); passed++;
  return response.json();
 }
 await db.exec('update product_sellers set stock=2 where id=1');
 const items=[{offer_id:1,quantity:1}];
 const quote=await request('quote',{items}); assert.equal(quote.total,150000); passed++;
 const payload={items,address:{full_name:'Integration Buyer',mobile:'09100000001',province:'Tehran',city:'Tehran',street:'Main Street'},key:'20000000-0000-0000-0000-000000000001',expected_total:quote.total};
 const order=await request('checkout',payload);
 const repeated=await request('checkout',payload); assert.equal(repeated.order_id,order.order_id); passed++;
 assert.equal((await db.query('select stock from product_sellers where id=1')).rows[0].stock,1); passed++;
 await request('checkout',{...payload,items:[{offer_id:1,quantity:2}]},409);
 const changed=await request('checkout',{...payload,key:'20000000-0000-0000-0000-000000000002',expected_total:1},409);
 assert.equal(changed.code,'price_changed'); passed++;
 await request('checkout',{...payload,user_id:other},400);
 uid=other;await request('fulfillment',{order_id:order.order_id,status:'processing'},409);
 uid=seller;await request('cancel',{order_id:order.order_id},409);
 await request('fulfillment',{order_id:order.order_id,status:'processing'});
 uid=buyer;await request('cancel',{order_id:order.order_id},409);
 uid=null;await request('quote',{items},401);
 console.log(`${passed} HTTP-to-PostgreSQL integration assertions passed.`);
}
