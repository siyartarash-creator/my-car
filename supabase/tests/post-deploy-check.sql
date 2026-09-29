-- Read-only post-deployment checks. No credentials/customer data returned.
begin transaction read only;
select 'profile_role_columns_protected' as check_name,
 not has_column_privilege('authenticated','public.profiles','is_admin','UPDATE')
 and not has_column_privilege('authenticated','public.profiles','user_type','UPDATE')
 and not has_table_privilege('authenticated','public.profiles','INSERT') as passed
union all select 'orders_not_directly_writable',
 not has_table_privilege('authenticated','public.orders','INSERT')
 and not has_table_privilege('authenticated','public.orders','UPDATE')
 and not has_table_privilege('authenticated','public.order_items','INSERT')
 and not has_table_privilege('authenticated','public.order_items','UPDATE')
union all select 'private_checkout_not_executable',
 not has_function_privilege('authenticated','private.checkout(jsonb,text,jsonb,uuid,boolean,bigint)','EXECUTE')
 and not has_function_privilege('anon','private.checkout(jsonb,text,jsonb,uuid,boolean,bigint)','EXECUTE')
union all select 'anonymous_checkout_denied',
 not has_function_privilege('anon','public.place_order(jsonb,jsonb,uuid,bigint,text)','EXECUTE')
union all select 'rls_enabled',
 not exists(select 1 from pg_tables where schemaname='public' and not rowsecurity)
union all select 'fulfillment_direct_writes_denied',
 not has_table_privilege('authenticated','public.seller_fulfillments','UPDATE')
union all select 'no_public_profile_select_policy',
 not exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and ('public'=any(roles) or 'anon'=any(roles)))
union all select 'definer_functions_pin_search_path',
 not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prosecdef and
 not coalesce('search_path=""'=any(p.proconfig),false));
rollback;
