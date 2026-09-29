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
