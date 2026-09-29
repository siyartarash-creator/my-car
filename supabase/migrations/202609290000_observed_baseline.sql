-- Application schema reconstructed from supplied metadata, not a complete service backup.
begin;
do $preflight$ declare actual text[]; begin
 select array_agg(tablename::text order by tablename) into actual from pg_tables where schemaname='public';
 if actual is not null and actual <> array['categories','coupon_usages','coupons','order_items','orders','payouts','product_compatibility','product_requests','product_sellers','products','profiles','sms_logs','sms_templates']::text[] then
   raise exception 'unexpected_public_tables_review_required'; end if;
end $preflight$;
do $bootstrap$ begin
if to_regclass('public.profiles') is null then
execute $ddl$
-- Local replay fixture reconstructed from observed columns and constraints.
-- NEVER apply this fixture to an existing/live database. Not a pg_dump.
set search_path = public;
create sequence public."categories_id_seq";
create sequence public."coupon_usages_id_seq";
create sequence public."coupons_id_seq";
create sequence public."order_items_id_seq";
create sequence public."orders_id_seq";
create sequence public."payouts_id_seq";
create sequence public."product_compatibility_id_seq";
create sequence public."product_requests_id_seq";
create sequence public."product_sellers_id_seq";
create sequence public."products_id_seq";
create sequence public."sms_logs_id_seq";
create sequence public."sms_templates_id_seq";
create table public."categories" (
  "id" bigint default nextval('categories_id_seq'::regclass) not null,
  "name" text not null,
  "slug" text not null,
  "parent_id" bigint,
  "icon" text,
  "sort_order" integer default 0,
  "created_at" timestamp with time zone default now()
);
create table public."coupon_usages" (
  "id" bigint default nextval('coupon_usages_id_seq'::regclass) not null,
  "coupon_id" bigint,
  "user_id" uuid,
  "order_id" bigint,
  "used_at" timestamp with time zone default now()
);
create table public."coupons" (
  "id" bigint default nextval('coupons_id_seq'::regclass) not null,
  "code" text not null,
  "discount_type" text not null,
  "discount_value" bigint not null,
  "min_order_amount" bigint default 0,
  "max_uses" integer,
  "used_count" integer default 0,
  "max_uses_per_user" integer default 1,
  "valid_from" timestamp with time zone default now(),
  "valid_until" timestamp with time zone,
  "is_active" boolean default true,
  "description" text,
  "created_at" timestamp with time zone default now()
);
create table public."order_items" (
  "id" bigint default nextval('order_items_id_seq'::regclass) not null,
  "order_id" bigint,
  "product_id" bigint,
  "product_name" text not null,
  "product_price" bigint not null,
  "quantity" integer default 1 not null,
  "seller_id" uuid
);
create table public."orders" (
  "id" bigint default nextval('orders_id_seq'::regclass) not null,
  "user_id" uuid,
  "status" text default 'pending'::text,
  "total_price" bigint default 0 not null,
  "shipping_cost" bigint default 0,
  "discount" bigint default 0,
  "final_price" bigint default 0 not null,
  "shipping_address" jsonb,
  "payment_method" text,
  "payment_status" text default 'pending'::text,
  "payment_ref" text,
  "tracking_code" text,
  "customer_notes" text,
  "admin_notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "coupon_id" bigint,
  "coupon_code" text,
  "coupon_discount" bigint default 0,
  "escrow_status" text default 'held'::text
);
create table public."payouts" (
  "id" bigint default nextval('payouts_id_seq'::regclass) not null,
  "seller_id" uuid not null,
  "order_id" bigint,
  "amount" bigint not null,
  "status" text default 'pending'::text not null,
  "payable_after" timestamp with time zone,
  "paid_at" timestamp with time zone,
  "payment_reference" text,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table public."product_compatibility" (
  "id" bigint default nextval('product_compatibility_id_seq'::regclass) not null,
  "product_id" bigint,
  "brand_id" text not null,
  "model_id" text,
  "trim_id" text,
  "year_from" integer,
  "year_to" integer
);
create table public."product_requests" (
  "id" bigint default nextval('product_requests_id_seq'::regclass) not null,
  "seller_id" uuid,
  "seller_name" text,
  "seller_mobile" text,
  "product_name" text not null,
  "brand" text,
  "photo_url" text,
  "status" text default 'pending'::text,
  "admin_notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table public."product_sellers" (
  "id" bigint default nextval('product_sellers_id_seq'::regclass) not null,
  "product_id" bigint,
  "seller_id" uuid,
  "seller_name" text not null,
  "price" bigint not null,
  "discount_price" bigint,
  "stock" integer default 0,
  "warranty" text,
  "shipping" text,
  "features" jsonb default '[]'::jsonb,
  "is_active" boolean default true,
  "created_at" timestamp with time zone default now(),
  "notes" text,
  "is_hidden_by_seller" boolean default false
);
create table public."products" (
  "id" bigint default nextval('products_id_seq'::regclass) not null,
  "name" text not null,
  "slug" text not null,
  "description" text,
  "short_description" text,
  "category_id" bigint,
  "brand" text,
  "part_number" text,
  "price" bigint default 0 not null,
  "discount_price" bigint,
  "stock" integer default 0,
  "images" jsonb default '[]'::jsonb,
  "specs" jsonb default '{}'::jsonb,
  "seller_id" uuid,
  "is_active" boolean default true,
  "is_featured" boolean default false,
  "views" integer default 0,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "reference_price" bigint,
  "reference_updated_at" timestamp with time zone
);
create table public."profiles" (
  "id" uuid not null,
  "user_type" text not null,
  "name" text not null,
  "mobile" text not null,
  "avatar_type" text default 'preset'::text,
  "avatar_value" text default '🚗'::text,
  "city" text,
  "region" text,
  "address" text,
  "phone1" text,
  "phone2" text,
  "working_hours" jsonb,
  "social_links" jsonb,
  "about" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "data" jsonb default '{}'::jsonb,
  "is_admin" boolean default false,
  "address_data" jsonb default '{}'::jsonb
);
create table public."sms_logs" (
  "id" bigint default nextval('sms_logs_id_seq'::regclass) not null,
  "user_id" uuid,
  "phone" text not null,
  "template_key" text not null,
  "message" text not null,
  "status" text default 'pending'::text not null,
  "kavenegar_id" text,
  "error_message" text,
  "cost" bigint default 0,
  "ip_address" text,
  "created_at" timestamp with time zone default now(),
  "sent_at" timestamp with time zone,
  "delivered_at" timestamp with time zone
);
create table public."sms_templates" (
  "id" bigint default nextval('sms_templates_id_seq'::regclass) not null,
  "key" text not null,
  "title" text not null,
  "body" text not null,
  "kavenegar_template" text,
  "variables" text[],
  "category" text default 'general'::text,
  "is_active" boolean default true,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
alter table public."categories" add constraint "categories_pkey" PRIMARY KEY (id);
alter table public."categories" add constraint "categories_slug_key" UNIQUE (slug);
alter table public."coupon_usages" add constraint "coupon_usages_pkey" PRIMARY KEY (id);
alter table public."coupons" add constraint "coupons_code_key" UNIQUE (code);
alter table public."coupons" add constraint "coupons_discount_type_check" CHECK ((discount_type = ANY (ARRAY['percent'::text, 'fixed'::text])));
alter table public."coupons" add constraint "coupons_pkey" PRIMARY KEY (id);
alter table public."order_items" add constraint "order_items_pkey" PRIMARY KEY (id);
alter table public."orders" add constraint "orders_escrow_status_check" CHECK ((escrow_status = ANY (ARRAY['held'::text, 'released'::text, 'refunded'::text])));
alter table public."orders" add constraint "orders_pkey" PRIMARY KEY (id);
alter table public."orders" add constraint "orders_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'processing'::text, 'shipped'::text, 'delivered'::text, 'cancelled'::text])));
alter table public."payouts" add constraint "payouts_pkey" PRIMARY KEY (id);
alter table public."payouts" add constraint "payouts_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'held'::text, 'paid'::text, 'cancelled'::text])));
alter table public."product_compatibility" add constraint "product_compatibility_pkey" PRIMARY KEY (id);
alter table public."product_requests" add constraint "product_requests_pkey" PRIMARY KEY (id);
alter table public."product_requests" add constraint "product_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'contacted'::text, 'approved'::text, 'rejected'::text])));
alter table public."product_sellers" add constraint "product_sellers_pkey" PRIMARY KEY (id);
alter table public."products" add constraint "products_pkey" PRIMARY KEY (id);
alter table public."products" add constraint "products_slug_key" UNIQUE (slug);
alter table public."profiles" add constraint "profiles_mobile_key" UNIQUE (mobile);
alter table public."profiles" add constraint "profiles_pkey" PRIMARY KEY (id);
alter table public."profiles" add constraint "profiles_user_type_check" CHECK ((user_type = ANY (ARRAY['owner'::text, 'seller'::text, 'service'::text, 'rescuer'::text])));
alter table public."sms_logs" add constraint "sms_logs_pkey" PRIMARY KEY (id);
alter table public."sms_logs" add constraint "sms_logs_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'delivered'::text])));
alter table public."sms_templates" add constraint "sms_templates_category_check" CHECK ((category = ANY (ARRAY['auth'::text, 'order'::text, 'marketing'::text, 'notification'::text, 'general'::text])));
alter table public."sms_templates" add constraint "sms_templates_key_key" UNIQUE (key);
alter table public."sms_templates" add constraint "sms_templates_pkey" PRIMARY KEY (id);
alter table public."categories" add constraint "categories_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE;
alter table public."coupon_usages" add constraint "coupon_usages_coupon_id_fkey" FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE CASCADE;
alter table public."coupon_usages" add constraint "coupon_usages_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public."coupon_usages" add constraint "coupon_usages_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."order_items" add constraint "order_items_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public."order_items" add constraint "order_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
alter table public."order_items" add constraint "order_items_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."orders" add constraint "orders_coupon_id_fkey" FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE SET NULL;
alter table public."orders" add constraint "orders_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."payouts" add constraint "payouts_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public."payouts" add constraint "payouts_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."product_compatibility" add constraint "product_compatibility_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public."product_requests" add constraint "product_requests_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."product_sellers" add constraint "product_sellers_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public."product_sellers" add constraint "product_sellers_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."products" add constraint "products_category_id_fkey" FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
alter table public."products" add constraint "products_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."sms_logs" add constraint "sms_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX idx_payouts_order_id ON public.payouts USING btree (order_id);
CREATE INDEX idx_payouts_seller_id ON public.payouts USING btree (seller_id);
CREATE INDEX idx_payouts_status ON public.payouts USING btree (status);
CREATE INDEX idx_sms_logs_created_at ON public.sms_logs USING btree (created_at DESC);
CREATE INDEX idx_sms_logs_phone ON public.sms_logs USING btree (phone);
CREATE INDEX idx_sms_logs_status ON public.sms_logs USING btree (status);
CREATE INDEX idx_sms_logs_user_id ON public.sms_logs USING btree (user_id);

alter table public."categories" enable row level security;
alter table public."coupon_usages" enable row level security;
alter table public."coupons" enable row level security;
alter table public."order_items" enable row level security;
alter table public."orders" enable row level security;
alter table public."payouts" enable row level security;
alter table public."product_compatibility" enable row level security;
alter table public."product_requests" enable row level security;
alter table public."product_sellers" enable row level security;
alter table public."products" enable row level security;
alter table public."profiles" enable row level security;
alter table public."sms_logs" enable row level security;
alter table public."sms_templates" enable row level security;
$ddl$;
end if;
end $bootstrap$;
do $columns$ declare c record; begin
for c in select * from jsonb_to_recordset('[{"table":"categories","column":"id","schema":"public","default":"nextval(''categories_id_seq''::regclass)","identity":"NO","nullable":"NO","position":1,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"categories","column":"name","schema":"public","default":null,"identity":"NO","nullable":"NO","position":2,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"categories","column":"slug","schema":"public","default":null,"identity":"NO","nullable":"NO","position":3,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"categories","column":"parent_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":4,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"categories","column":"icon","schema":"public","default":null,"identity":"NO","nullable":"YES","position":5,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"categories","column":"sort_order","schema":"public","default":"0","identity":"NO","nullable":"YES","position":6,"udt_name":"int4","data_type":"integer","generated":"NEVER"},{"table":"categories","column":"created_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":7,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"coupon_usages","column":"id","schema":"public","default":"nextval(''coupon_usages_id_seq''::regclass)","identity":"NO","nullable":"NO","position":1,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"coupon_usages","column":"coupon_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":2,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"coupon_usages","column":"user_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":3,"udt_name":"uuid","data_type":"uuid","generated":"NEVER"},{"table":"coupon_usages","column":"order_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":4,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"coupon_usages","column":"used_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":5,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"coupons","column":"id","schema":"public","default":"nextval(''coupons_id_seq''::regclass)","identity":"NO","nullable":"NO","position":1,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"coupons","column":"code","schema":"public","default":null,"identity":"NO","nullable":"NO","position":2,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"coupons","column":"discount_type","schema":"public","default":null,"identity":"NO","nullable":"NO","position":3,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"coupons","column":"discount_value","schema":"public","default":null,"identity":"NO","nullable":"NO","position":4,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"coupons","column":"min_order_amount","schema":"public","default":"0","identity":"NO","nullable":"YES","position":5,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"coupons","column":"max_uses","schema":"public","default":null,"identity":"NO","nullable":"YES","position":6,"udt_name":"int4","data_type":"integer","generated":"NEVER"},{"table":"coupons","column":"used_count","schema":"public","default":"0","identity":"NO","nullable":"YES","position":7,"udt_name":"int4","data_type":"integer","generated":"NEVER"},{"table":"coupons","column":"max_uses_per_user","schema":"public","default":"1","identity":"NO","nullable":"YES","position":8,"udt_name":"int4","data_type":"integer","generated":"NEVER"},{"table":"coupons","column":"valid_from","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":9,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"coupons","column":"valid_until","schema":"public","default":null,"identity":"NO","nullable":"YES","position":10,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"coupons","column":"is_active","schema":"public","default":"true","identity":"NO","nullable":"YES","position":11,"udt_name":"bool","data_type":"boolean","generated":"NEVER"},{"table":"coupons","column":"description","schema":"public","default":null,"identity":"NO","nullable":"YES","position":12,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"coupons","column":"created_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":13,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"order_items","column":"id","schema":"public","default":"nextval(''order_items_id_seq''::regclass)","identity":"NO","nullable":"NO","position":1,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"order_items","column":"order_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":2,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"order_items","column":"product_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":3,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"order_items","column":"product_name","schema":"public","default":null,"identity":"NO","nullable":"NO","position":4,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"order_items","column":"product_price","schema":"public","default":null,"identity":"NO","nullable":"NO","position":5,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"order_items","column":"quantity","schema":"public","default":"1","identity":"NO","nullable":"NO","position":6,"udt_name":"int4","data_type":"integer","generated":"NEVER"},{"table":"order_items","column":"seller_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":7,"udt_name":"uuid","data_type":"uuid","generated":"NEVER"},{"table":"orders","column":"id","schema":"public","default":"nextval(''orders_id_seq''::regclass)","identity":"NO","nullable":"NO","position":1,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"orders","column":"user_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":2,"udt_name":"uuid","data_type":"uuid","generated":"NEVER"},{"table":"orders","column":"status","schema":"public","default":"''pending''::text","identity":"NO","nullable":"YES","position":3,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"orders","column":"total_price","schema":"public","default":"0","identity":"NO","nullable":"NO","position":4,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"orders","column":"shipping_cost","schema":"public","default":"0","identity":"NO","nullable":"YES","position":5,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"orders","column":"discount","schema":"public","default":"0","identity":"NO","nullable":"YES","position":6,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"orders","column":"final_price","schema":"public","default":"0","identity":"NO","nullable":"NO","position":7,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"orders","column":"shipping_address","schema":"public","default":null,"identity":"NO","nullable":"YES","position":8,"udt_name":"jsonb","data_type":"jsonb","generated":"NEVER"},{"table":"orders","column":"payment_method","schema":"public","default":null,"identity":"NO","nullable":"YES","position":9,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"orders","column":"payment_status","schema":"public","default":"''pending''::text","identity":"NO","nullable":"YES","position":10,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"orders","column":"payment_ref","schema":"public","default":null,"identity":"NO","nullable":"YES","position":11,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"orders","column":"tracking_code","schema":"public","default":null,"identity":"NO","nullable":"YES","position":12,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"orders","column":"customer_notes","schema":"public","default":null,"identity":"NO","nullable":"YES","position":13,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"orders","column":"admin_notes","schema":"public","default":null,"identity":"NO","nullable":"YES","position":14,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"orders","column":"created_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":15,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"orders","column":"updated_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":16,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"orders","column":"coupon_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":17,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"orders","column":"coupon_code","schema":"public","default":null,"identity":"NO","nullable":"YES","position":18,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"orders","column":"coupon_discount","schema":"public","default":"0","identity":"NO","nullable":"YES","position":19,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"orders","column":"escrow_status","schema":"public","default":"''held''::text","identity":"NO","nullable":"YES","position":20,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"payouts","column":"id","schema":"public","default":"nextval(''payouts_id_seq''::regclass)","identity":"NO","nullable":"NO","position":1,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"payouts","column":"seller_id","schema":"public","default":null,"identity":"NO","nullable":"NO","position":2,"udt_name":"uuid","data_type":"uuid","generated":"NEVER"},{"table":"payouts","column":"order_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":3,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"payouts","column":"amount","schema":"public","default":null,"identity":"NO","nullable":"NO","position":4,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"payouts","column":"status","schema":"public","default":"''pending''::text","identity":"NO","nullable":"NO","position":5,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"payouts","column":"payable_after","schema":"public","default":null,"identity":"NO","nullable":"YES","position":6,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"payouts","column":"paid_at","schema":"public","default":null,"identity":"NO","nullable":"YES","position":7,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"payouts","column":"payment_reference","schema":"public","default":null,"identity":"NO","nullable":"YES","position":8,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"payouts","column":"notes","schema":"public","default":null,"identity":"NO","nullable":"YES","position":9,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"payouts","column":"created_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":10,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"payouts","column":"updated_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":11,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"product_compatibility","column":"id","schema":"public","default":"nextval(''product_compatibility_id_seq''::regclass)","identity":"NO","nullable":"NO","position":1,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"product_compatibility","column":"product_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":2,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"product_compatibility","column":"brand_id","schema":"public","default":null,"identity":"NO","nullable":"NO","position":3,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"product_compatibility","column":"model_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":4,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"product_compatibility","column":"trim_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":5,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"product_compatibility","column":"year_from","schema":"public","default":null,"identity":"NO","nullable":"YES","position":6,"udt_name":"int4","data_type":"integer","generated":"NEVER"},{"table":"product_compatibility","column":"year_to","schema":"public","default":null,"identity":"NO","nullable":"YES","position":7,"udt_name":"int4","data_type":"integer","generated":"NEVER"},{"table":"product_requests","column":"id","schema":"public","default":"nextval(''product_requests_id_seq''::regclass)","identity":"NO","nullable":"NO","position":1,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"product_requests","column":"seller_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":2,"udt_name":"uuid","data_type":"uuid","generated":"NEVER"},{"table":"product_requests","column":"seller_name","schema":"public","default":null,"identity":"NO","nullable":"YES","position":3,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"product_requests","column":"seller_mobile","schema":"public","default":null,"identity":"NO","nullable":"YES","position":4,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"product_requests","column":"product_name","schema":"public","default":null,"identity":"NO","nullable":"NO","position":5,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"product_requests","column":"brand","schema":"public","default":null,"identity":"NO","nullable":"YES","position":6,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"product_requests","column":"photo_url","schema":"public","default":null,"identity":"NO","nullable":"YES","position":7,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"product_requests","column":"status","schema":"public","default":"''pending''::text","identity":"NO","nullable":"YES","position":8,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"product_requests","column":"admin_notes","schema":"public","default":null,"identity":"NO","nullable":"YES","position":9,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"product_requests","column":"created_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":10,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"product_requests","column":"updated_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":11,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"product_sellers","column":"id","schema":"public","default":"nextval(''product_sellers_id_seq''::regclass)","identity":"NO","nullable":"NO","position":1,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"product_sellers","column":"product_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":2,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"product_sellers","column":"seller_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":3,"udt_name":"uuid","data_type":"uuid","generated":"NEVER"},{"table":"product_sellers","column":"seller_name","schema":"public","default":null,"identity":"NO","nullable":"NO","position":4,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"product_sellers","column":"price","schema":"public","default":null,"identity":"NO","nullable":"NO","position":5,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"product_sellers","column":"discount_price","schema":"public","default":null,"identity":"NO","nullable":"YES","position":6,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"product_sellers","column":"stock","schema":"public","default":"0","identity":"NO","nullable":"YES","position":7,"udt_name":"int4","data_type":"integer","generated":"NEVER"},{"table":"product_sellers","column":"warranty","schema":"public","default":null,"identity":"NO","nullable":"YES","position":8,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"product_sellers","column":"shipping","schema":"public","default":null,"identity":"NO","nullable":"YES","position":9,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"product_sellers","column":"features","schema":"public","default":"''[]''::jsonb","identity":"NO","nullable":"YES","position":10,"udt_name":"jsonb","data_type":"jsonb","generated":"NEVER"},{"table":"product_sellers","column":"is_active","schema":"public","default":"true","identity":"NO","nullable":"YES","position":11,"udt_name":"bool","data_type":"boolean","generated":"NEVER"},{"table":"product_sellers","column":"created_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":12,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"product_sellers","column":"notes","schema":"public","default":null,"identity":"NO","nullable":"YES","position":13,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"product_sellers","column":"is_hidden_by_seller","schema":"public","default":"false","identity":"NO","nullable":"YES","position":14,"udt_name":"bool","data_type":"boolean","generated":"NEVER"},{"table":"products","column":"id","schema":"public","default":"nextval(''products_id_seq''::regclass)","identity":"NO","nullable":"NO","position":1,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"products","column":"name","schema":"public","default":null,"identity":"NO","nullable":"NO","position":2,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"products","column":"slug","schema":"public","default":null,"identity":"NO","nullable":"NO","position":3,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"products","column":"description","schema":"public","default":null,"identity":"NO","nullable":"YES","position":4,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"products","column":"short_description","schema":"public","default":null,"identity":"NO","nullable":"YES","position":5,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"products","column":"category_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":6,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"products","column":"brand","schema":"public","default":null,"identity":"NO","nullable":"YES","position":7,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"products","column":"part_number","schema":"public","default":null,"identity":"NO","nullable":"YES","position":8,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"products","column":"price","schema":"public","default":"0","identity":"NO","nullable":"NO","position":9,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"products","column":"discount_price","schema":"public","default":null,"identity":"NO","nullable":"YES","position":10,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"products","column":"stock","schema":"public","default":"0","identity":"NO","nullable":"YES","position":11,"udt_name":"int4","data_type":"integer","generated":"NEVER"},{"table":"products","column":"images","schema":"public","default":"''[]''::jsonb","identity":"NO","nullable":"YES","position":12,"udt_name":"jsonb","data_type":"jsonb","generated":"NEVER"},{"table":"products","column":"specs","schema":"public","default":"''{}''::jsonb","identity":"NO","nullable":"YES","position":13,"udt_name":"jsonb","data_type":"jsonb","generated":"NEVER"},{"table":"products","column":"seller_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":14,"udt_name":"uuid","data_type":"uuid","generated":"NEVER"},{"table":"products","column":"is_active","schema":"public","default":"true","identity":"NO","nullable":"YES","position":15,"udt_name":"bool","data_type":"boolean","generated":"NEVER"},{"table":"products","column":"is_featured","schema":"public","default":"false","identity":"NO","nullable":"YES","position":16,"udt_name":"bool","data_type":"boolean","generated":"NEVER"},{"table":"products","column":"views","schema":"public","default":"0","identity":"NO","nullable":"YES","position":17,"udt_name":"int4","data_type":"integer","generated":"NEVER"},{"table":"products","column":"created_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":18,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"products","column":"updated_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":19,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"products","column":"reference_price","schema":"public","default":null,"identity":"NO","nullable":"YES","position":20,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"products","column":"reference_updated_at","schema":"public","default":null,"identity":"NO","nullable":"YES","position":21,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"profiles","column":"id","schema":"public","default":null,"identity":"NO","nullable":"NO","position":1,"udt_name":"uuid","data_type":"uuid","generated":"NEVER"},{"table":"profiles","column":"user_type","schema":"public","default":null,"identity":"NO","nullable":"NO","position":2,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"profiles","column":"name","schema":"public","default":null,"identity":"NO","nullable":"NO","position":3,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"profiles","column":"mobile","schema":"public","default":null,"identity":"NO","nullable":"NO","position":4,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"profiles","column":"avatar_type","schema":"public","default":"''preset''::text","identity":"NO","nullable":"YES","position":5,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"profiles","column":"avatar_value","schema":"public","default":"''🚗''::text","identity":"NO","nullable":"YES","position":6,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"profiles","column":"city","schema":"public","default":null,"identity":"NO","nullable":"YES","position":7,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"profiles","column":"region","schema":"public","default":null,"identity":"NO","nullable":"YES","position":8,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"profiles","column":"address","schema":"public","default":null,"identity":"NO","nullable":"YES","position":9,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"profiles","column":"phone1","schema":"public","default":null,"identity":"NO","nullable":"YES","position":10,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"profiles","column":"phone2","schema":"public","default":null,"identity":"NO","nullable":"YES","position":11,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"profiles","column":"working_hours","schema":"public","default":null,"identity":"NO","nullable":"YES","position":12,"udt_name":"jsonb","data_type":"jsonb","generated":"NEVER"},{"table":"profiles","column":"social_links","schema":"public","default":null,"identity":"NO","nullable":"YES","position":13,"udt_name":"jsonb","data_type":"jsonb","generated":"NEVER"},{"table":"profiles","column":"about","schema":"public","default":null,"identity":"NO","nullable":"YES","position":14,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"profiles","column":"created_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":15,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"profiles","column":"updated_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":16,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"profiles","column":"data","schema":"public","default":"''{}''::jsonb","identity":"NO","nullable":"YES","position":17,"udt_name":"jsonb","data_type":"jsonb","generated":"NEVER"},{"table":"profiles","column":"is_admin","schema":"public","default":"false","identity":"NO","nullable":"YES","position":18,"udt_name":"bool","data_type":"boolean","generated":"NEVER"},{"table":"profiles","column":"address_data","schema":"public","default":"''{}''::jsonb","identity":"NO","nullable":"YES","position":19,"udt_name":"jsonb","data_type":"jsonb","generated":"NEVER"},{"table":"sms_logs","column":"id","schema":"public","default":"nextval(''sms_logs_id_seq''::regclass)","identity":"NO","nullable":"NO","position":1,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"sms_logs","column":"user_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":2,"udt_name":"uuid","data_type":"uuid","generated":"NEVER"},{"table":"sms_logs","column":"phone","schema":"public","default":null,"identity":"NO","nullable":"NO","position":3,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"sms_logs","column":"template_key","schema":"public","default":null,"identity":"NO","nullable":"NO","position":4,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"sms_logs","column":"message","schema":"public","default":null,"identity":"NO","nullable":"NO","position":5,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"sms_logs","column":"status","schema":"public","default":"''pending''::text","identity":"NO","nullable":"NO","position":6,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"sms_logs","column":"kavenegar_id","schema":"public","default":null,"identity":"NO","nullable":"YES","position":7,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"sms_logs","column":"error_message","schema":"public","default":null,"identity":"NO","nullable":"YES","position":8,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"sms_logs","column":"cost","schema":"public","default":"0","identity":"NO","nullable":"YES","position":9,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"sms_logs","column":"ip_address","schema":"public","default":null,"identity":"NO","nullable":"YES","position":10,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"sms_logs","column":"created_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":11,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"sms_logs","column":"sent_at","schema":"public","default":null,"identity":"NO","nullable":"YES","position":12,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"sms_logs","column":"delivered_at","schema":"public","default":null,"identity":"NO","nullable":"YES","position":13,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"sms_templates","column":"id","schema":"public","default":"nextval(''sms_templates_id_seq''::regclass)","identity":"NO","nullable":"NO","position":1,"udt_name":"int8","data_type":"bigint","generated":"NEVER"},{"table":"sms_templates","column":"key","schema":"public","default":null,"identity":"NO","nullable":"NO","position":2,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"sms_templates","column":"title","schema":"public","default":null,"identity":"NO","nullable":"NO","position":3,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"sms_templates","column":"body","schema":"public","default":null,"identity":"NO","nullable":"NO","position":4,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"sms_templates","column":"kavenegar_template","schema":"public","default":null,"identity":"NO","nullable":"YES","position":5,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"sms_templates","column":"variables","schema":"public","default":null,"identity":"NO","nullable":"YES","position":6,"udt_name":"_text","data_type":"ARRAY","generated":"NEVER"},{"table":"sms_templates","column":"category","schema":"public","default":"''general''::text","identity":"NO","nullable":"YES","position":7,"udt_name":"text","data_type":"text","generated":"NEVER"},{"table":"sms_templates","column":"is_active","schema":"public","default":"true","identity":"NO","nullable":"YES","position":8,"udt_name":"bool","data_type":"boolean","generated":"NEVER"},{"table":"sms_templates","column":"created_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":9,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"},{"table":"sms_templates","column":"updated_at","schema":"public","default":"now()","identity":"NO","nullable":"YES","position":10,"udt_name":"timestamptz","data_type":"timestamp with time zone","generated":"NEVER"}]') as x("table" text,"column" text,udt_name text,nullable text) loop
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=c."table" and column_name=c."column" and udt_name=c.udt_name and is_nullable=c.nullable) then
  raise exception 'schema_drift_review_required: %.%',c."table",c."column"; end if;
end loop;
end $columns$;
commit;
