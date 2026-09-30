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

const post=await db.exec(fs.readFileSync(path.join(base,'supabase/tests/post-deploy-check.sql'),'utf8'));
for(const result of post)for(const row of result.rows??[])if('passed' in row){assert.equal(row.passed,true,row.check_name);passed++;}
console.log(`${passed} database security/transaction assertions passed (${existing ? "existing schema" : "empty schema"}).`);
await testWriteIntegration(db,buyer,seller,other);
await db.close();
}
run(false).then(()=>run(true)).catch(e=>{console.error(e.message);process.exitCode=1});
