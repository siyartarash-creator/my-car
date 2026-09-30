import { testWriteIntegration } from "./write-integration.mjs";
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const base=fileURLToPath(new URL('../',import.meta.url));
async function run(existing) {
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security; grant usage on schema storage to anon,authenticated;
grant select,insert,update,delete on storage.objects to anon,authenticated;`);
if(existing) {
 await db.exec(fs.readFileSync(path.join(base,'supabase/tests/observed-schema.sql'),'utf8'));
 await db.exec(`grant all on all tables in schema public to public,anon,authenticated;
 grant update(is_admin,user_type) on profiles to authenticated;
 create policy unsafe_profiles on profiles for all using(true) with check(true);
 create policy unsafe_orders on orders for all using(true) with check(true);
 insert into auth.users(id) values('90000000-0000-0000-0000-000000000001');
 insert into profiles(id,user_type,name,mobile) values('90000000-0000-0000-0000-000000000001','seller','Legacy','09199999999');
 insert into orders(id,user_id,status,total_price,final_price,shipping_address) values(9000,'90000000-0000-0000-0000-000000000001','shipped',777,777,'{"city":"Legacy City"}');
 insert into order_items(id,order_id,product_name,product_price,quantity,seller_id) values(9000,9000,'Legacy Part',777,1,'90000000-0000-0000-0000-000000000001');`);
}
for(const f of fs.readdirSync(path.join(base,'supabase/migrations')).sort()) await db.exec(fs.readFileSync(path.join(base,'supabase/migrations',f),'utf8'));
if(existing){
 const legacy=(await db.query('select i.offer_id,f.status,o.final_price from order_items i join seller_fulfillments f on i.fulfillment_id=f.id join orders o on o.id=f.order_id where i.id=9000')).rows[0];
 assert.deepEqual(legacy,{offer_id:null,status:'shipped',final_price:777});
 await db.exec("delete from order_items where id=9000; delete from seller_fulfillments where order_id=9000; delete from orders where id=9000; delete from auth.users where id='90000000-0000-0000-0000-000000000001'");
}
const buyer='00000000-0000-0000-0000-000000000001',seller='00000000-0000-0000-0000-000000000002',other='00000000-0000-0000-0000-000000000003';
await db.exec(`insert into auth.users values ('${buyer}','{"name":"Buyer","mobile":"09100000001","user_type":"owner"}'),('${seller}','{"name":"Seller","mobile":"09100000002","user_type":"seller"}'),('${other}','{"name":"Other","mobile":"09100000003","user_type":"seller"}');
insert into products(id,name,slug) values(1,'Part','part');
insert into product_sellers(id,product_id,seller_id,seller_name,price,stock) values(1,1,'${seller}','Seller',100000,3),(2,1,'${other}','Other',200000,3);
insert into coupons(code,discount_type,discount_value,max_uses) values('ONE','percent',10,1);`);
let passed=0;
async function as(uid,fn){await db.exec(`set role ${uid?'authenticated':'anon'}; select set_config('request.jwt.claim.sub','${uid??''}',false);`);try{return await fn();}finally{await db.exec('reset role');}}
async function deny(sql){await assert.rejects(()=>db.exec(sql));passed++;}
async function check(sql,value){const r=await db.query(sql);assert.deepEqual(Object.values(r.rows[0])[0],value);passed++;}
const address=JSON.stringify({full_name:'Buyer Name',mobile:'09100000001',province:'Tehran',city:'Tehran',street:'Main street'});
const key='10000000-0000-0000-0000-000000000001';
const place=(items,k=key,coupon='ONE',total)=>`select public.place_order('${JSON.stringify(items)}','${address}','${k}',${total??(50000+items.reduce((s,i)=>s+i.quantity*(i.offer_id===2?200000:100000),0)*(coupon?0.9:1))},${coupon?`'${coupon}'`:'null'})`;
await as(null,async()=>{await deny('select * from profiles');await deny(place([{offer_id:1,quantity:1}]));await check('select count(*)::int from product_sellers',2);});
await as(buyer,async()=>{
 await check('select count(*)::int from profiles',1);
 await deny('update profiles set is_admin=true'); await deny("update profiles set user_type='seller'");
 await deny("insert into orders(user_id,total_price,final_price) values(auth.uid(),1,1)");
 await deny('update product_sellers set stock=999');
 await deny("insert into profiles(id,name,mobile,user_type,is_admin) values(auth.uid(),'Fake','09199999999','owner',true)");
 await deny("select save_offer(1,null,1,null,1,null,null,null,false)");
 await deny(place([{offer_id:1,quantity:0}])); await deny(place([{offer_id:1,quantity:4}]));
 await deny(place([{offer_id:1,quantity:1,price:1}])); await deny(place([{offer_id:1,quantity:1},{offer_id:1,quantity:1}]));
 await check("select (quote_checkout('[{\"offer_id\":1,\"quantity\":1}]','ONE')->>'total')::int",140000);
 const first=(await db.query(place([{offer_id:1,quantity:1},{offer_id:2,quantity:1}]))).rows[0].place_order;
 assert.equal(first.total,320000);passed++;
 const repeat=(await db.query(place([{offer_id:1,quantity:1},{offer_id:2,quantity:1}]))).rows[0].place_order;
 assert.equal(first.order_id,repeat.order_id);passed++;
 await deny(place([{offer_id:1,quantity:2}]));
 await deny(place([{offer_id:1,quantity:1}],'10000000-0000-0000-0000-000000000002'));
 await check('select count(*)::int from seller_fulfillments',2);
 await deny(`update orders set final_price=1 where id=${first.order_id}`);
});
await check('select stock from product_sellers where id=1',2);
await check('select count(*)::int from orders',1);
await check('select used_count from coupons',1);
await as(seller,async()=>{
 await check('select count(*)::int from orders',0);
 await check('select count(*)::int from order_items',1);
 await check('select count(*)::int from seller_fulfillments',1);
 await deny("select advance_fulfillment(1,'delivered')");
 await db.exec("select advance_fulfillment(1,'processing')");passed++;
 await deny("select save_offer(1,2,1,null,2,null,null,null,false)");
 await deny("insert into storage.objects(bucket_id,name) values('avatars','someone-else/test.png')");
 await db.exec(`insert into storage.objects(bucket_id,name) values('avatars','${seller}/test.png')`);passed++;
 await deny("insert into storage.objects(bucket_id,name) values('products','test.png')");
});
await as(buyer,()=>deny('select cancel_order(1)'));
await as(other,async()=>{
 await check("select status from seller_fulfillments where order_id=1",'pending');
 await deny('select cancel_order(1)');
});
await as(buyer,async()=>{
 const r=(await db.query(place([{offer_id:1,quantity:1}],'10000000-0000-0000-0000-000000000003',null))).rows[0].place_order;
 await db.exec(`select cancel_order(${r.order_id}); select cancel_order(${r.order_id})`);passed++;
});
await check('select stock from product_sellers where id=1',2);
await as(buyer,async()=>{
 await deny(place([{offer_id:1,quantity:1}],'10000000-0000-0000-0000-000000000020',null,1));
 await check('select count(*)::int from payouts',0);
 await deny("update orders set status='paid'");
 await deny('delete from coupon_usages');
 await deny('select private.checkout(null,null,null,null,false,null)');
 await deny("select advance_fulfillment(1,'processing')");
});
await db.exec(`insert into coupons(code,discount_type,discount_value,valid_from) values('FUTURE','fixed',10,now()+interval '1 day');
insert into coupons(code,discount_type,discount_value,valid_until) values('EXPIRED','fixed',10,now()-interval '1 day');
insert into coupons(code,discount_type,discount_value,min_order_amount) values('MIN','fixed',10,9999999);
insert into coupons(code,discount_type,discount_value,max_uses_per_user) values('PERUSER','fixed',10,1);
insert into coupon_usages(coupon_id,user_id) select id,'${buyer}' from coupons where code='PERUSER';
insert into product_sellers(id,product_id,seller_id,seller_name,price,stock,is_hidden_by_seller) values(3,1,'${seller}','Hidden',1000,3,true);`);
await as(buyer,async()=>{
 for(const code of ['FUTURE','EXPIRED','MIN','PERUSER'])await deny(`select quote_checkout('[{"offer_id":1,"quantity":1}]','${code}')`);
 await deny("select quote_checkout('[{\"offer_id\":3,\"quantity\":1}]',null)");
 await deny("select quote_checkout('[{\"offer_id\":1,\"quantity\":1.5}]',null)");
 await deny("select quote_checkout('[{\"offer_id\":1,\"quantity\":-1}]',null)");
 await deny("select quote_checkout('[]',null)");
 await db.exec("update profiles set name='Buyer updated' where id=auth.uid()");passed++;
 await check('select is_admin()',false);
 await check('select count(*)::int from product_sellers where id=3',0);
});
await as(seller,async()=>{
 await check('select count(*)::int from product_sellers where id=3',1);
 await db.exec("select advance_fulfillment(1,'shipped'); select advance_fulfillment(1,'delivered')");passed++;
 await deny("select advance_fulfillment(1,'processing')");
});
await check("select status from orders where id=1",'processing');
await as(other,async()=>{
 await db.exec("select advance_fulfillment(1,'processing'); select advance_fulfillment(1,'shipped'); select advance_fulfillment(1,'delivered')");passed++;
 await db.exec(`delete from storage.objects where name='${seller}/test.png'`);
});
await check("select status from orders where id=1",'delivered');
await check('select count(*)::int from storage.objects',1);
// Force a failure AFTER parent/items/stock writes; the entire operation must roll back.
await db.exec(`insert into coupons(code,discount_type,discount_value) values('ROLLBACK','percent',10);
create function public.test_failure() returns trigger language plpgsql as $$begin raise exception 'injected_test_failure'; end$$;
create trigger fail_test before insert on coupon_usages for each row execute function public.test_failure();`);
const beforeOrders=(await db.query('select count(*)::int n from orders')).rows[0].n;
await as(buyer,()=>deny(place([{offer_id:1,quantity:1}],'10000000-0000-0000-0000-000000000030','ROLLBACK')));
await check('select count(*)::int from orders',beforeOrders);
await check('select stock from product_sellers where id=1',2);
await check("select used_count from coupons where code='ROLLBACK'",0);
await db.exec('drop trigger fail_test on coupon_usages; drop function public.test_failure()');
// Last-unit competition and repeated submissions on the embedded engine's serialized connection.
await db.exec('update product_sellers set stock=1 where id=1');
await as(buyer,async()=>{
 const requests = [40,41].map(n=>db.query(place([{offer_id:1,quantity:1}],`10000000-0000-0000-0000-0000000000${n}`,null)));
 const results=await Promise.allSettled(requests);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);passed++;
});
await check('select stock from product_sellers where id=1',0);
// Trusted server-side profile creation ignores forged administrator metadata.
await db.exec(`insert into auth.users values('00000000-0000-0000-0000-000000000004','{"name":"New User","mobile":"09100000004","user_type":"seller","is_admin":true}')`);
await check("select is_admin from profiles where id='00000000-0000-0000-0000-000000000004'",false);
await as(seller,async()=>{
 await db.exec("insert into product_requests(seller_id,seller_name,product_name) values(auth.uid(),'Forged Name','Requested Part')");
 await check('select seller_name from product_requests limit 1','Seller');
 await deny("insert into product_requests(seller_id,product_name,status) values(auth.uid(),'Request','approved')");
 await deny("insert into products(name,slug) values('Unauthorized','unauthorized')");
});
// Phase 4 / Task 4.2A: above-threshold discount request foundation.
// Fixture rows above were inserted with explicit ids, never advancing product_sellers_id_seq;
// sync it so save_offer's nextval()-backed inserts below don't collide with those ids.
await db.exec("select setval('product_sellers_id_seq', (select coalesce(max(id),0) from product_sellers))");
const pA=(await db.query("insert into products(name,slug) values('Discount Part A','discount-part-a') returning id")).rows[0].id;
const pB=(await db.query("insert into products(name,slug) values('Discount Part B','discount-part-b') returning id")).rows[0].id;
let offerA;
await as(seller,async()=>{
 // 1. below-threshold discount applies live.
 offerA=(await db.query(`select public.save_offer(${pA},null,100000,70000,5,null,null,null,false)`)).rows[0].save_offer;
 await check(`select discount_price from product_sellers where id=${offerA}`,70000);
 await check(`select count(*)::int from discount_requests where offer_id=${offerA}`,0);
 // 2. exactly-threshold discount (35%) applies live.
 await db.exec(`select public.save_offer(${pA},${offerA},100000,65000,5,null,null,null,false)`);
 await check(`select discount_price from product_sellers where id=${offerA}`,65000);
 await check(`select count(*)::int from discount_requests where offer_id=${offerA}`,0);
 // 3. above-threshold (50%) request is created but the requested discount is NOT live.
 await db.exec(`select public.save_offer(${pA},${offerA},100000,50000,5,null,null,null,false)`);
 await check(`select discount_price from product_sellers where id=${offerA}`,65000);
 await check(`select status from discount_requests where offer_id=${offerA} and requested_discount_price=50000`,'pending');
 await check(`select count(*)::int from discount_requests where offer_id=${offerA} and status='pending'`,1);
 // 4. previously-approved live discount remains unchanged while the request is pending.
 await check(`select price from product_sellers where id=${offerA}`,100000);
 await check(`select discount_price from product_sellers where id=${offerA}`,65000);
 // Edge case E: same call changes base price AND asks above threshold -> rejected, nothing changes.
 await deny(`select public.save_offer(${pA},${offerA},120000,50000,5,null,null,null,false)`);
 await check(`select price from product_sellers where id=${offerA}`,100000);
 await check(`select discount_price from product_sellers where id=${offerA}`,65000);
 await check(`select count(*)::int from discount_requests where offer_id=${offerA} and status='pending'`,1);
 // Base price CAN change while a request is pending, when the same call is not itself an
 // above-threshold ask: this supersedes the stale pending request instead of leaving it dangling.
 await db.exec(`select public.save_offer(${pA},${offerA},90000,60000,5,null,null,null,false)`);
 await check(`select price from product_sellers where id=${offerA}`,90000);
 await check(`select discount_price from product_sellers where id=${offerA}`,60000);
 await check(`select count(*)::int from discount_requests where offer_id=${offerA} and status='pending'`,0);
 await check(`select count(*)::int from discount_requests where offer_id=${offerA} and status='superseded'`,1);
 // A brand-new Offer created directly above threshold: no live discount, one pending request.
 const offerB=(await db.query(`select public.save_offer(${pB},null,200000,100000,5,null,null,null,false)`)).rows[0].save_offer;
 await check(`select discount_price from product_sellers where id=${offerB}`,null);
 await check(`select price from product_sellers where id=${offerB}`,200000);
 await check(`select count(*)::int from discount_requests where offer_id=${offerB} and status='pending' and base_price_snapshot=200000 and requested_discount_price=100000`,1);
 // 9. invalid request values are rejected (existing invariant, still enforced with the new logic present).
 await deny(`select public.save_offer(${pA},${offerA},90000,0,5,null,null,null,false)`);
 await deny(`select public.save_offer(${pA},${offerA},90000,95000,5,null,null,null,false)`);
 // 5. ordinary seller cannot approve their own request: no permission, no direct-write route.
 await check("select has_permission('discounts.approve')",false);
 await deny(`update discount_requests set status='approved' where offer_id=${offerA}`);
 await deny(`insert into discount_requests(offer_id,seller_id,base_price_snapshot,requested_discount_price,status) values(${offerA},auth.uid(),90000,1,'approved')`);
 await deny(`select admin_grant_permission(auth.uid(),'discounts.approve')`);
 // 7. no direct table/RPC bypass can make an above-threshold discount live.
 await deny(`update product_sellers set discount_price=1 where id=${offerA}`);
});
await as(other,async()=>{
 // 6. a seller cannot create/manage a discount request for another seller's Offer (IDOR).
 await deny(`select public.save_offer(${pA},${offerA},90000,50000,5,null,null,null,false)`);
 await deny(`insert into discount_requests(offer_id,seller_id,base_price_snapshot,requested_discount_price) values(${offerA},auth.uid(),90000,1)`);
 await check(`select count(*)::int from discount_requests where offer_id=${offerA} and seller_id='${other}'`,0);
});
// 8. the threshold is read from marketplace_settings, not a duplicated literal.
await db.exec('update marketplace_settings set seller_autonomous_discount_max_percent=50 where id=1');
await as(seller,async()=>{
 // 40% off was above the old 35% threshold; at the new 50% threshold it applies live directly.
 await db.exec(`select public.save_offer(${pA},${offerA},100000,60000,5,null,null,null,false)`);
 await check(`select discount_price from product_sellers where id=${offerA}`,60000);
});
await db.exec('update marketplace_settings set seller_autonomous_discount_max_percent=35 where id=1');
await db.exec(`update profiles set is_admin=true where id='${other}'`);
await as(other,async()=>{
 await check('select is_admin()',true);
 await db.exec("insert into products(name,slug) values('Admin Part','admin-part')");passed++;
 await deny('update profiles set is_admin=false');
 await deny('update orders set final_price=1');
});
// Phase 4 / Task 4.2B: discount request approval / rejection.
// `other` is Super Admin (is_admin=true above); `operator` gets only the
// discounts.approve grant, to independently prove the non-admin path works.
const operator='00000000-0000-0000-0000-000000000004';
await as(other,async()=>{ await db.exec(`select admin_grant_permission('${operator}','discounts.approve')`);passed++; });
await check(`select count(*)::int from operator_permissions where profile_id='${operator}' and permission_key='discounts.approve'`,1);

// P2 lock-order fix regression: approve_discount_request now locates its Offer via an
// UNLOCKED probe read before taking any row lock (Offer locked first, then Request --
// matching save_offer's own order, to remove the deadlock-prone Request-first order a
// prior revision used). A nonexistent request must still fail cleanly through that new
// two-phase lookup instead of erroring some other way.
await as(operator,()=>deny('select approve_discount_request(999999)'));

let reqId;
await as(seller,async()=>{
 // Fresh above-threshold ask on the existing offerA (price=100000, live discount=60000); price unchanged, so this is the unambiguous pending path.
 await db.exec(`select public.save_offer(${pA},${offerA},100000,50000,5,null,null,null,false)`);
 reqId=(await db.query(`select id from discount_requests where offer_id=${offerA} and status='pending' order by id desc limit 1`)).rows[0].id;
});
// 3. a user without discounts.approve cannot approve.
await as(buyer,()=>deny(`select approve_discount_request(${reqId})`));
// 4. the request's own seller cannot approve merely by ownership.
await as(seller,()=>deny(`select approve_discount_request(${reqId})`));
// 2. an operator granted discounts.approve (not Super Admin) can approve.
await as(operator,async()=>{
 await db.exec(`select approve_discount_request(${reqId})`);passed++;
 // 5. valid approval updates the live discount correctly.
 await check(`select discount_price from product_sellers where id=${offerA}`,50000);
 // 6. the correct request is marked approved with trusted actor/time.
 await check(`select status from discount_requests where id=${reqId}`,'approved');
 await check(`select (decided_by='${operator}')::boolean from discount_requests where id=${reqId}`,true);
 await check(`select (decided_at is not null)::boolean from discount_requests where id=${reqId}`,true);
 // 12. an already-decided request cannot be decided again.
 await deny(`select approve_discount_request(${reqId})`);
 await deny(`select reject_discount_request(${reqId})`);
});
// 7. approval created an explicit audit log entry.
await check(`select count(*)::int from admin_audit_log where action='approve_discount_request' and target_id='${reqId}' and actor_id='${operator}'`,1);

let reqId2;
await as(seller,async()=>{
 await db.exec(`select public.save_offer(${pA},${offerA},100000,40000,5,null,null,null,false)`);
 reqId2=(await db.query(`select id from discount_requests where offer_id=${offerA} and status='pending' order by id desc limit 1`)).rows[0].id;
});
// 1. Super Admin can decide requests too (here: reject).
await as(other,async()=>{
 await db.exec(`select reject_discount_request(${reqId2},'too aggressive')`);passed++;
 // 8. rejection leaves the live Offer unchanged.
 await check(`select discount_price from product_sellers where id=${offerA}`,50000);
 // 9. the request is marked rejected with trusted actor/time.
 await check(`select status from discount_requests where id=${reqId2}`,'rejected');
 await check(`select (decided_by='${other}')::boolean from discount_requests where id=${reqId2}`,true);
 await check(`select (decided_at is not null)::boolean from discount_requests where id=${reqId2}`,true);
});
// 10. rejection created an explicit audit log entry.
await check(`select count(*)::int from admin_audit_log where action='reject_discount_request' and target_id='${reqId2}' and actor_id='${other}' and reason='too aggressive'`,1);
// 11. no cross-Offer bleed: an unrelated Offer is untouched by any decision above.
const offerBId=(await db.query(`select id from product_sellers where product_id=${pB} and seller_id='${seller}'`)).rows[0].id;
await check(`select discount_price from product_sellers where id=${offerBId}`,null);

// 13. a base-price snapshot mismatch blocks approval atomically; the request stays pending, live Offer untouched.
let reqId3;
await as(seller,async()=>{
 await db.exec(`select public.save_offer(${pA},${offerA},100000,45000,5,null,null,null,false)`);
 reqId3=(await db.query(`select id from discount_requests where offer_id=${offerA} and status='pending' order by id desc limit 1`)).rows[0].id;
});
// Simulate the base price moving after the request was filed but before it was decided.
await db.exec(`update product_sellers set price=120000 where id=${offerA}`);
await as(operator,()=>deny(`select approve_discount_request(${reqId3})`));
await check(`select price from product_sellers where id=${offerA}`,120000);
await check(`select discount_price from product_sellers where id=${offerA}`,50000);
await check(`select status from discount_requests where id=${reqId3}`,'pending');
await db.exec(`update product_sellers set price=100000 where id=${offerA}`);
await as(other,async()=>{ await db.exec(`select reject_discount_request(${reqId3})`);passed++; });

// 14. an invalid requested discount can never be persisted, so it can never reach approval/live
// (table CHECK constraint, exercised directly -- independent of the grant-based denial in 18).
await deny(`insert into discount_requests(offer_id,seller_id,base_price_snapshot,requested_discount_price) values(${offerA},'${seller}',100000,150000)`);

// 15. approval never re-derives/hardcodes the threshold: it applies exactly the requested value
// regardless of the CURRENT configured threshold at decision time.
let reqId4;
await as(seller,async()=>{
 await db.exec(`select public.save_offer(${pA},${offerA},100000,42000,5,null,null,null,false)`);
 reqId4=(await db.query(`select id from discount_requests where offer_id=${offerA} and status='pending' order by id desc limit 1`)).rows[0].id;
});
await db.exec('update marketplace_settings set seller_autonomous_discount_max_percent=5 where id=1');
await as(operator,async()=>{ await db.exec(`select approve_discount_request(${reqId4})`);passed++; });
await check(`select discount_price from product_sellers where id=${offerA}`,42000);
await db.exec('update marketplace_settings set seller_autonomous_discount_max_percent=35 where id=1');

// 16. existing <=threshold seller behavior remains intact after adding approve/reject.
// 17. the locked combined base-price-change + above-threshold ask on an EXISTING Offer remains rejected.
const pC=(await db.query("insert into products(name,slug) values('Discount Part C','discount-part-c') returning id")).rows[0].id;
await as(seller,async()=>{
 const offerC=(await db.query(`select public.save_offer(${pC},null,50000,40000,3,null,null,null,false)`)).rows[0].save_offer;
 await check(`select discount_price from product_sellers where id=${offerC}`,40000);
 await check(`select count(*)::int from discount_requests where offer_id=${offerC}`,0);
 await deny(`select public.save_offer(${pA},${offerA},130000,50000,5,null,null,null,false)`);
 await check(`select price from product_sellers where id=${offerA}`,100000);
});

// 18. direct client writes cannot bypass the decision RPCs, even for a caller who holds
// discounts.approve or is Super Admin -- only the RPCs (owned by the table owner) may write.
await as(operator,async()=>{
 await deny(`update discount_requests set status='approved' where id=${reqId2}`);
 await deny(`update product_sellers set discount_price=1 where id=${offerA}`);
 await deny(`insert into discount_requests(offer_id,seller_id,base_price_snapshot,requested_discount_price,status,decided_by,decided_at) values(${offerA},'${seller}',100000,1,'approved','${operator}',now())`);
});
await as(other,async()=>{
 await deny(`update discount_requests set status='rejected' where id=${reqId2}`);
 await deny(`update product_sellers set discount_price=1 where id=${offerA}`);
});

// Phase 4 / Task 4.3: offer moderation (activate/deactivate) foundation.
await as(other,async()=>{ await db.exec(`select admin_grant_permission('${operator}','offers.moderate')`);passed++; });
await check(`select count(*)::int from operator_permissions where profile_id='${operator}' and permission_key='offers.moderate'`,1);

const pD=(await db.query("insert into products(name,slug) values('Moderation Part D','moderation-part-d') returning id")).rows[0].id;
const pE=(await db.query("insert into products(name,slug) values('Moderation Part E','moderation-part-e') returning id")).rows[0].id;
let offerD, offerE;
await as(seller,async()=>{
 offerD=(await db.query(`select public.save_offer(${pD},null,80000,70000,4,'w','s','n',false)`)).rows[0].save_offer;
 offerE=(await db.query(`select public.save_offer(${pE},null,90000,null,2,null,null,null,false)`)).rows[0].save_offer;
});
await check(`select is_active from product_sellers where id=${offerD}`,true);

// 3. unauthorized user cannot deactivate.
await as(buyer,()=>deny(`select deactivate_offer(${offerD},'counterfeit parts')`));
// 4. seller cannot deactivate/activate own Offer by ownership alone.
await as(seller,()=>deny(`select deactivate_offer(${offerD},'counterfeit parts')`));
await as(seller,()=>deny(`select activate_offer(${offerD})`));
// 12. save_offer cannot manipulate is_active -- it takes no is_active parameter at all, and a
// normal update call leaves the flag untouched.
await as(seller,async()=>{
 await db.exec(`select public.save_offer(${pD},${offerD},80000,70000,4,'w','s','n',false)`);
 await check(`select is_active from product_sellers where id=${offerD}`,true);
});
// 11. direct client update of is_active is blocked, even for a caller who holds offers.moderate
// or is Super Admin -- only the RPCs (owned by the table owner) may write it.
await as(operator,()=>deny(`update product_sellers set is_active=false where id=${offerD}`));
await as(other,()=>deny(`update product_sellers set is_active=false where id=${offerD}`));

// 5. empty/whitespace/absent deactivation reason rejected.
await as(operator,async()=>{
 await deny(`select deactivate_offer(${offerD},null)`);
 await deny(`select deactivate_offer(${offerD},'')`);
 await deny(`select deactivate_offer(${offerD},'   ')`);
 await check(`select is_active from product_sellers where id=${offerD}`,true);
});

// 2. an offers.moderate operator (not Super Admin) can deactivate, given a real reason.
await as(operator,async()=>{ await db.exec(`select deactivate_offer(${offerD},'Counterfeit parts reported by buyers')`);passed++; });
// offer_read (pre-existing, Phase 1 RLS, unchanged by this task) only lets a non-admin see an
// Offer that is is_active=true, its own, or the caller is_admin() -- holding offers.moderate
// does not itself grant read access to an Offer just deactivated, same as discounts.approve
// does not grant admin_audit_log read. So state is verified here (bypasses RLS, same
// convention as every other post-condition check in this file), not inside the operator role.
// 6. successful deactivation sets only the intended is_active state.
await check(`select is_active from product_sellers where id=${offerD}`,false);
// 15. price/stock/discount fields remain unchanged by moderation.
await check(`select price from product_sellers where id=${offerD}`,80000);
await check(`select discount_price from product_sellers where id=${offerD}`,70000);
await check(`select stock from product_sellers where id=${offerD}`,4);
// 7. deactivation audit contains trusted actor, target and reason.
await check(`select count(*)::int from admin_audit_log where action='deactivate_offer' and target_id='${offerD}' and actor_id='${operator}' and reason='Counterfeit parts reported by buyers'`,1);

// 17. an inactive Offer remains excluded/rejected wherever the existing catalog/checkout
// contract already requires it (verified, not redesigned: shop_catalog and private.checkout
// already filter/reject on is_active independently of this task).
await check(`select count(*)::int from shop_catalog where offer_id=${offerD}`,0);
await as(buyer,()=>deny(`select quote_checkout('[{"offer_id":${offerD},"quantity":1}]',null)`));

// 1. Super Admin can activate too (the deactivate path above already exercised the operator
// grant; here the Super Admin bypass is exercised explicitly on activation).
await as(other,async()=>{
 await db.exec(`select activate_offer(${offerD})`);passed++;
 // 8. Super Admin/operator can activate.
 await check(`select is_active from product_sellers where id=${offerD}`,true);
});
// 9. activation audited.
await check(`select count(*)::int from admin_audit_log where action='activate_offer' and target_id='${offerD}' and actor_id='${other}'`,1);
// 10. unauthorized activation denied.
await as(buyer,()=>deny(`select activate_offer(${offerD})`));
await as(seller,()=>deny(`select activate_offer(${offerD})`));

// 13. cross-Offer/IDOR: moderating offerD never touches an unrelated Offer.
await check(`select is_active from product_sellers where id=${offerE}`,true);
await check(`select discount_price from product_sellers where id=${offerE}`,null);

// 16. pending discount-request state remains unchanged by moderation; moderation never
// touches discount_requests. 18. existing 4.2 discount behavior is not weakened by adding
// moderation.
let reqE;
await as(seller,async()=>{
 await db.exec(`select public.save_offer(${pE},${offerE},90000,40000,2,null,null,null,false)`); // ~55.6% off, above threshold -> pending
 reqE=(await db.query(`select id from discount_requests where offer_id=${offerE} and status='pending' order by id desc limit 1`)).rows[0].id;
});
await as(operator,async()=>{ await db.exec(`select deactivate_offer(${offerE},'temporary listing pause')`);passed++; });
await check(`select status from discount_requests where id=${reqE}`,'pending');
await check(`select discount_price from product_sellers where id=${offerE}`,null);
await as(operator,async()=>{
 await db.exec(`select activate_offer(${offerE})`);passed++;
 await db.exec(`select approve_discount_request(${reqE})`);passed++;
 await check(`select discount_price from product_sellers where id=${offerE}`,40000);
 await check(`select status from discount_requests where id=${reqE}`,'approved');
});

// 14. an audit failure rolls back the moderation atomically (mirrors the existing
// coupon_usages rollback test elsewhere in this file).
await db.exec(`create function public.test_audit_failure() returns trigger language plpgsql as $$begin raise exception 'injected_audit_failure'; end$$;
create trigger fail_audit before insert on admin_audit_log for each row execute function public.test_audit_failure();`);
await as(operator,()=>deny(`select deactivate_offer(${offerD},'should not apply')`));
await check(`select is_active from product_sellers where id=${offerD}`,true);
await db.exec('drop trigger fail_audit on admin_audit_log; drop function public.test_audit_failure()');

// Admin Panel Completion, Checkpoint A: Admin Core entry boundary
// (has_any_permission) and the operator_permissions self-read policy.
// `operator` already holds 'discounts.approve' and 'offers.moderate' from
// the Task 4.2B/4.3 sections above; `other` is Super Admin; `buyer`/`seller`
// hold no operator_permissions grants.
await as(null,()=>check('select has_any_permission()',false));
await as(buyer,()=>check('select has_any_permission()',false));
await as(seller,()=>check('select has_any_permission()',false));
await as(operator,()=>check('select has_any_permission()',true));
await as(other,()=>check('select has_any_permission()',true));
await as(operator,async()=>{
 // self-read: an operator can see exactly their own grant rows (2: the
 // 4.2B/4.3 grants above), and nothing granted to a different profile.
 await check("select count(*)::int from operator_permissions where profile_id=auth.uid()",2);
 await check(`select count(*)::int from operator_permissions where profile_id<>auth.uid()`,0);
});
await as(buyer,()=>check('select count(*)::int from operator_permissions',0));
await as(null,()=>deny('select count(*)::int from operator_permissions'));

// Admin Panel Completion, Checkpoint B: Store Admin Module.
// Grant `operator` the remaining permissions this checkpoint wires up, on
// top of the discounts.approve/offers.moderate it already holds.
await as(other,async()=>{
 await db.exec(`select admin_grant_permission('${operator}','requests.review');
  select admin_grant_permission('${operator}','coupons.manage');
  select admin_grant_permission('${operator}','orders.read')`);passed++;
});

// --- product_requests: review_product_request (replaces the old direct
// admin UPDATE path; now audited and permission-gated, not is_admin()-only).
let prId;
await as(seller,async()=>{
 await db.exec("insert into product_requests(seller_id,seller_name,product_name) values(auth.uid(),'Seller','Checkpoint B Part')");
 prId=(await db.query("select id from product_requests where product_name='Checkpoint B Part'")).rows[0].id;
});
await as(buyer,()=>deny(`select review_product_request(${prId},'approved',null)`));
await as(seller,()=>deny(`select review_product_request(${prId},'approved',null)`)); // request owner, not reviewer
await as(operator,async()=>{
 await deny(`select review_product_request(${prId},'pending',null)`); // pending is initial-only, not a decision
 await db.exec(`select review_product_request(${prId},'approved','looks good')`);passed++;
 await check(`select status from product_requests where id=${prId}`,'approved');
 await check(`select admin_notes from product_requests where id=${prId}`,'looks good');
 // direct-table bypass blocked even for a caller who holds requests.review: only the RPC writes.
 await deny(`update product_requests set status='rejected' where id=${prId}`);
});
await check(`select count(*)::int from admin_audit_log where action='review_product_request' and target_id='${prId}' and actor_id='${operator}'`,1);

// --- Admin review fix (202609300010): review_product_request finality.
// Only a 'pending' request may be reviewed; once decided (contacted/approved/
// rejected) a further call must fail, leave status unchanged, and append no
// new audit row -- mirroring the status='pending' guard already enforced by
// approve_discount_request/reject_discount_request.
await as(operator,async()=>{
 await deny(`select review_product_request(${prId},'rejected','flip-flop attempt')`); // already approved, not pending
 await check(`select status from product_requests where id=${prId}`,'approved'); // status unchanged after failed re-decision
});
await check(`select count(*)::int from admin_audit_log where action='review_product_request' and target_id='${prId}'`,1); // no new audit row from the failed re-decision

let prId2;
await as(seller,async()=>{
 await db.exec("insert into product_requests(seller_id,seller_name,product_name) values(auth.uid(),'Seller','Checkpoint B Part 2')");
 prId2=(await db.query("select id from product_requests where product_name='Checkpoint B Part 2'")).rows[0].id;
});
await as(operator,async()=>{
 await db.exec(`select review_product_request(${prId2},'rejected','not applicable')`);passed++; // pending -> rejected succeeds
 await deny(`select review_product_request(${prId2},'approved','changed my mind')`); // rejected -> another decision fails
 await check(`select status from product_requests where id=${prId2}`,'rejected'); // status unchanged after failed re-decision
});
await check(`select count(*)::int from admin_audit_log where action='review_product_request' and target_id='${prId2}'`,1); // no new audit row from the failed re-decision

// --- coupons: admin_create_coupon / admin_set_coupon_active / admin_delete_coupon
// (replaces the old direct INSERT/UPDATE/DELETE admin_write policy).
await as(buyer,()=>deny("select admin_create_coupon('CKB10','percent',10,0,null,1,null,null)"));
let couponId;
await as(operator,async()=>{
 await deny("select admin_create_coupon('XY','percent',10,0,null,1,null,null)"); // too short
 await deny("select admin_create_coupon('CKB10','percent',150,0,null,1,null,null)"); // >100%
 couponId=(await db.query("select admin_create_coupon('ckb10','percent',10,0,null,1,null,'checkpoint b')")).rows[0].admin_create_coupon;
 await check(`select code from coupons where id=${couponId}`,'CKB10'); // normalized upper/trimmed
 await deny(`insert into coupons(code,discount_type,discount_value) values('BYPASS','fixed',1)`); // direct write blocked
 await db.exec(`select admin_set_coupon_active(${couponId},false)`);passed++;
 await check(`select is_active from coupons where id=${couponId}`,false);
});
await check(`select count(*)::int from admin_audit_log where action='create_coupon' and target_id='${couponId}' and actor_id='${operator}'`,1);
await check(`select count(*)::int from admin_audit_log where action='deactivate_coupon' and target_id='${couponId}' and actor_id='${operator}'`,1);
await as(seller,()=>deny(`select admin_delete_coupon(${couponId})`));
await as(operator,async()=>{ await db.exec(`select admin_delete_coupon(${couponId})`);passed++; });
await check(`select count(*)::int from coupons where id=${couponId}`,0);
await check(`select count(*)::int from admin_audit_log where action='delete_coupon' and actor_id='${operator}'`,1);

// --- offer_read widened for offers.moderate/discounts.approve operators (not
// just the Offer's own seller or Super Admin), needed for the Store Admin
// Offer-moderation / discount-request pages to list/display inactive Offers.
const pCkB=(await db.query("insert into products(name,slug) values('Checkpoint B Part','checkpoint-b-part') returning id")).rows[0].id;
let offerCkB;
await as(seller,async()=>{
 offerCkB=(await db.query(`select public.save_offer(${pCkB},null,60000,null,3,null,null,null,false)`)).rows[0].save_offer;
});
await as(operator,async()=>{ await db.exec(`select deactivate_offer(${offerCkB},'checkpoint b visibility test')`);passed++; });
await as(operator,()=>check(`select count(*)::int from product_sellers where id=${offerCkB}`,1)); // offers.moderate operator can still see it
await as(buyer,()=>check(`select count(*)::int from product_sellers where id=${offerCkB}`,0)); // inactive + not owner + no permission

// --- order_read widened for orders.read operators (read-only; no write grant/policy added).
await as(operator,async()=>{ const n=(await db.query('select count(*)::int n from orders')).rows[0].n; assert.ok(n>0);passed++; });
await as(seller,async()=>{ await check('select count(*)::int from orders',0); }); // seller holds no orders.read grant and owns no orders

// --- Admin review fix (202609300010): products.write -- admin_create_product
// / admin_update_product / admin_delete_product (replaces the legacy
// admin_write-gated direct INSERT/UPDATE/DELETE on products, matching the
// coupons/product_requests conversion in 202609300008). `productOperator` is
// a fresh profile granted only products.write; `operator` deliberately does
// NOT hold products.write (it holds discounts.approve/offers.moderate/
// requests.review/coupons.manage/orders.read only), so it doubles as the
// "unrelated-permission operator must be denied" case.
const productOperator='00000000-0000-0000-0000-000000000005';
await db.exec(`insert into auth.users values ('${productOperator}','{"name":"Product Admin","mobile":"09100000005","user_type":"owner"}')`);
await as(other,async()=>{ await db.exec(`select admin_grant_permission('${productOperator}','products.write')`);passed++; });

const createSql="select admin_create_product('New Part','new-part-ckfix',null,null,null,null,null,null,null,false)";
await as(null,()=>deny(createSql));
await as(buyer,()=>deny(createSql));
await as(operator,()=>deny(createSql)); // unrelated permissions only, not products.write

let newProductId;
await as(productOperator,async()=>{
 await deny("select admin_create_product('AB','ab-part-ckfix',null,null,null,null,null,null,null,false)"); // name too short
 await deny("select admin_create_product('Valid Name','Not A Slug!',null,null,null,null,null,null,null,false)"); // invalid slug
 newProductId=(await db.query(createSql)).rows[0].admin_create_product;
 await check(`select is_active from products where id=${newProductId}`,true);
 await deny(`insert into products(name,slug) values('Bypass','bypass-part-ckfix')`); // direct-table insert blocked
 await deny(`update products set name='Bypass' where id=${newProductId}`); // direct-table update blocked, even for a products.write holder
});
await check(`select count(*)::int from admin_audit_log where action='create_product' and target_id='${newProductId}' and actor_id='${productOperator}'`,1);
await check(`select count(*)::int from admin_audit_log where action='create_product' and actor_id='${operator}'`,0); // the earlier denied attempt was not audited

await as(seller,()=>deny(`select admin_update_product(${newProductId},'Nope','new-part-ckfix',null,null,null,null,null,null,null,true,true)`));
await as(other,async()=>{ // Super Admin bypass
 await db.exec(`select admin_update_product(${newProductId},'New Part Updated','new-part-ckfix',null,null,null,null,null,null,null,true,true)`);passed++;
 await check(`select name from products where id=${newProductId}`,'New Part Updated');
});
await check(`select count(*)::int from admin_audit_log where action='update_product' and target_id='${newProductId}' and actor_id='${other}'`,1);

// product_read widened for products.write operators (parallel to offer_read/
// coupon_read/order_read/request_read): they must see inactive products too,
// to manage them -- but an unrelated-permission operator, an ordinary buyer,
// and anon must not.
let hiddenProductId;
await as(productOperator,async()=>{
 hiddenProductId=(await db.query("select admin_create_product('Hidden Part','hidden-part-ckfix',null,null,null,null,null,null,null,false)")).rows[0].admin_create_product;
 await db.exec(`select admin_update_product(${hiddenProductId},'Hidden Part','hidden-part-ckfix',null,null,null,null,null,null,null,false,false)`);passed++;
});
await as(productOperator,()=>check(`select count(*)::int from products where id=${hiddenProductId}`,1));
await as(buyer,()=>check(`select count(*)::int from products where id=${hiddenProductId}`,0));
await as(null,()=>check(`select count(*)::int from products where id=${hiddenProductId}`,0));
await as(operator,()=>check(`select count(*)::int from products where id=${hiddenProductId}`,0));

await as(buyer,()=>deny(`select admin_delete_product(${hiddenProductId})`));
await as(productOperator,()=>deny(`delete from products where id=${hiddenProductId}`)); // direct-table delete blocked, even for a products.write holder
await as(productOperator,async()=>{ await db.exec(`select admin_delete_product(${hiddenProductId})`);passed++; });
await check(`select count(*)::int from products where id=${hiddenProductId}`,0);
await as(productOperator,async()=>{ await db.exec(`select admin_delete_product(${newProductId})`);passed++; });
await check(`select count(*)::int from products where id=${newProductId}`,0);
await check(`select count(*)::int from admin_audit_log where action='delete_product' and actor_id='${productOperator}'`,2);

// Admin Panel Completion, Checkpoint C: Audit View stays Super-Admin-only.
// `operator` by this point holds discounts.approve, offers.moderate,
// requests.review, coupons.manage and orders.read -- i.e. every operator
// permission this checkpoint's dashboard/audit work touches -- yet must
// still see zero admin_audit_log rows, proving the Checkpoint C locked
// decision (no operator audit-read permission was added) actually holds at
// the RLS layer, not just in the page's requireSuperAdmin() call.
await as(operator,()=>check('select count(*)::int from admin_audit_log',0));
await as(buyer,()=>check('select count(*)::int from admin_audit_log',0));
await as(null,()=>deny('select count(*)::int from admin_audit_log'));
await as(other,async()=>{ const n=(await db.query('select count(*)::int n from admin_audit_log')).rows[0].n; assert.ok(n>0);passed++; }); // Super Admin sees the full log

const post=await db.exec(fs.readFileSync(path.join(base,'supabase/tests/post-deploy-check.sql'),'utf8'));
for(const result of post)for(const row of result.rows??[])if('passed' in row){assert.equal(row.passed,true,row.check_name);passed++;}
console.log(`${passed} database security/transaction assertions passed (${existing ? "existing schema" : "empty schema"}).`);
await testWriteIntegration(db,buyer,seller,other);
await db.close();
}
run(false).then(()=>run(true)).catch(e=>{console.error(e.message);process.exitCode=1});
