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
await db.exec(`update profiles set is_admin=true where id='${other}'`);
await as(other,async()=>{
 await check('select is_admin()',true);
 await db.exec("insert into products(name,slug) values('Admin Part','admin-part')");passed++;
 await deny('update profiles set is_admin=false');
 await deny('update orders set final_price=1');
});
const post=await db.exec(fs.readFileSync(path.join(base,'supabase/tests/post-deploy-check.sql'),'utf8'));
for(const result of post)for(const row of result.rows??[])if('passed' in row){assert.equal(row.passed,true,row.check_name);passed++;}
console.log(`${passed} database security/transaction assertions passed (${existing ? "existing schema" : "empty schema"}).`);
await testWriteIntegration(db,buyer,seller,other);
await db.close();
}
run(false).then(()=>run(true)).catch(e=>{console.error(e.message);process.exitCode=1});
