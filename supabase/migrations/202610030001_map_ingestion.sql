begin;
-- MY CAR Map/Navigation Phase 1, Part 2: ingestion + moderation pipeline.
-- SOURCE -> IMPORT BATCH -> RAW/STAGING -> VALIDATION -> NORMALIZATION ->
-- DEDUPLICATION -> REVIEW -> PROMOTION -> CANONICAL (map_features).
-- Admin-only in Phase 1: no public-facing bulk import exists yet, so every
-- table and RPC here is gated by private.is_admin(), same as categories/
-- products direct-write convention.
create table public.map_import_batches (
  id bigint generated always as identity primary key,
  source_id bigint not null references public.map_sources(id),
  kind text not null check (kind in ('manual','csv','excel','bulk','external_api')),
  status text not null default 'pending' check (status in ('pending','validating','normalizing','reviewing','promoted','rejected','rolled_back')),
  file_ref text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.map_staging_features (
  id bigint generated always as identity primary key,
  batch_id bigint not null references public.map_import_batches(id) on delete cascade,
  raw jsonb not null,
  normalized jsonb,
  dedup_key text,
  validation_errors jsonb,
  status text not null default 'raw' check (status in ('raw','validated','normalized','duplicate','promoted','rejected')),
  promoted_feature_id bigint references public.map_features(id),
  created_at timestamptz not null default now()
);
create index map_staging_features_batch_idx on public.map_staging_features(batch_id);
create index map_staging_features_dedup_idx on public.map_staging_features(dedup_key);

do $$ declare t text;
begin
  foreach t in array array['map_import_batches', 'map_staging_features'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

grant select on public.map_import_batches, public.map_staging_features to authenticated;
create policy map_import_batch_admin_only on public.map_import_batches for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy map_staging_feature_admin_only on public.map_staging_features for all to authenticated using (private.is_admin()) with check (private.is_admin());
grant insert, update, delete on public.map_import_batches, public.map_staging_features to authenticated;

create function public.create_import_batch(p_source_code text, p_kind text, p_file_ref text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare src_id bigint; result_id bigint;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if p_kind not in ('manual','csv','excel','bulk','external_api') then raise exception 'invalid_kind'; end if;
  select id into src_id from public.map_sources where code = p_source_code;
  if src_id is null then raise exception 'unknown_source'; end if;
  insert into public.map_import_batches(source_id, kind, file_ref, created_by)
  values (src_id, p_kind, p_file_ref, auth.uid()) returning id into result_id;
  return result_id;
end $$;
revoke all on function public.create_import_batch(text, text, text) from public, anon, authenticated;
grant execute on function public.create_import_batch(text, text, text) to authenticated;

create function public.stage_import_row(p_batch_id bigint, p_raw jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare result_id bigint;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.map_import_batches where id = p_batch_id) then raise exception 'batch_not_found'; end if;
  insert into public.map_staging_features(batch_id, raw, status) values (p_batch_id, p_raw, 'raw') returning id into result_id;
  update public.map_import_batches set status = 'validating' where id = p_batch_id and status = 'pending';
  return result_id;
end $$;
revoke all on function public.stage_import_row(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.stage_import_row(bigint, jsonb) to authenticated;

-- Deterministic validation + normalization + dedup-key computation. A raw
-- row is expected to carry {name_fa, lat, lng, category_slug, external_ref}.
-- Any AI-assisted suggestion for these fields is advisory input to p_raw
-- only -- this function is the sole, deterministic gate that can mark a
-- row 'normalized'; nothing here or downstream treats an AI label as
-- already-validated.
create function public.validate_and_normalize_staging(p_staging_id bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare row_ record; errors jsonb := '[]'::jsonb; name_fa text; lat double precision; lng double precision;
  category_slug text; category_id bigint; key text; dup_id bigint;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  select * into row_ from public.map_staging_features where id = p_staging_id;
  if row_ is null then raise exception 'staging_row_not_found'; end if;

  name_fa := btrim(row_.raw->>'name_fa');
  category_slug := row_.raw->>'category_slug';
  begin lat := (row_.raw->>'lat')::double precision; exception when others then lat := null; end;
  begin lng := (row_.raw->>'lng')::double precision; exception when others then lng := null; end;

  if coalesce(length(name_fa), 0) = 0 or length(name_fa) > 200 then
    errors := errors || jsonb_build_array('invalid_name_fa');
  end if;
  if lat is null or lat < -90 or lat > 90 then errors := errors || jsonb_build_array('invalid_lat'); end if;
  if lng is null or lng < -180 or lng > 180 then errors := errors || jsonb_build_array('invalid_lng'); end if;
  select id into category_id from public.map_poi_categories where slug = category_slug;
  if category_id is null then errors := errors || jsonb_build_array('unknown_category'); end if;

  if jsonb_array_length(errors) > 0 then
    update public.map_staging_features set status = 'rejected', validation_errors = errors where id = p_staging_id;
    return p_staging_id;
  end if;

  lat := round(lat::numeric, 6); lng := round(lng::numeric, 6);
  key := lower(name_fa) || ':' || category_slug || ':' || round(lat::numeric, 4) || ':' || round(lng::numeric, 4);

  select f.id into dup_id from public.map_features f
  where f.dedup_key = key and f.status in ('verified', 'pending') limit 1;

  update public.map_staging_features set
    normalized = jsonb_build_object('name_fa', name_fa, 'lat', lat, 'lng', lng, 'category_slug', category_slug,
      'external_ref', row_.raw->>'external_ref'),
    dedup_key = key,
    validation_errors = null,
    status = case when dup_id is not null then 'duplicate' else 'normalized' end,
    promoted_feature_id = dup_id
  where id = p_staging_id;
  return p_staging_id;
end $$;
revoke all on function public.validate_and_normalize_staging(bigint) from public, anon, authenticated;
grant execute on function public.validate_and_normalize_staging(bigint) to authenticated;

create function public.reject_staging_feature(p_staging_id bigint, p_note text) returns bigint
language sql security definer set search_path = '' as $$
  update public.map_staging_features set status = 'rejected',
    validation_errors = coalesce(validation_errors, '[]'::jsonb) || jsonb_build_array(coalesce(p_note, 'admin_rejected'))
  where id = p_staging_id and private.is_admin()
  returning id;
$$;
revoke all on function public.reject_staging_feature(bigint, text) from public, anon, authenticated;
grant execute on function public.reject_staging_feature(bigint, text) to authenticated;

-- promote_staging_feature: an admin explicitly promoting a normalized row
-- is the verification step itself, so the resulting feature lands
-- 'verified' directly (unlike community-report promotion, which still
-- requires a separate verification pass -- see review_community_report).
create function public.promote_staging_feature(p_staging_id bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare row_ record; batch_ record; category_id bigint; feature_id bigint;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  select * into row_ from public.map_staging_features where id = p_staging_id;
  if row_ is null then raise exception 'staging_row_not_found'; end if;
  if row_.status <> 'normalized' then raise exception 'not_normalized'; end if;
  select * into batch_ from public.map_import_batches where id = row_.batch_id;
  select id into category_id from public.map_poi_categories where slug = row_.normalized->>'category_slug';

  insert into public.map_features(category_id, source_id, external_ref, name_fa, lat, lng, status, confidence, dedup_key, verified_by, verified_at)
  values (category_id, batch_.source_id, row_.normalized->>'external_ref', row_.normalized->>'name_fa',
    (row_.normalized->>'lat')::double precision, (row_.normalized->>'lng')::double precision,
    'verified', 1.0, row_.dedup_key, auth.uid(), now())
  returning id into feature_id;

  insert into public.map_feature_provenance(feature_id, action, actor, source_id, note)
  values (feature_id, 'promoted', auth.uid(), batch_.source_id, 'batch ' || row_.batch_id::text);

  update public.map_staging_features set status = 'promoted', promoted_feature_id = feature_id where id = p_staging_id;
  update public.map_import_batches set status = 'promoted' where id = row_.batch_id and status <> 'rolled_back';
  return feature_id;
end $$;
revoke all on function public.promote_staging_feature(bigint) from public, anon, authenticated;
grant execute on function public.promote_staging_feature(bigint) to authenticated;

-- rollback_import_batch: a correction path for a bad batch. Soft-reverts
-- every feature the batch promoted (status -> 'rejected', never deleted,
-- so provenance and any dependent rows stay intact) rather than a hard
-- delete/history rewrite.
create function public.rollback_import_batch(p_batch_id bigint) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer := 0; r record;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  for r in select id, promoted_feature_id from public.map_staging_features where batch_id = p_batch_id and status = 'promoted' loop
    update public.map_features set status = 'rejected', updated_at = now() where id = r.promoted_feature_id;
    insert into public.map_feature_provenance(feature_id, action, actor, note)
    values (r.promoted_feature_id, 'rejected', auth.uid(), 'batch ' || p_batch_id::text || ' rollback');
    n := n + 1;
  end loop;
  update public.map_import_batches set status = 'rolled_back', completed_at = now() where id = p_batch_id;
  return n;
end $$;
revoke all on function public.rollback_import_batch(bigint) from public, anon, authenticated;
grant execute on function public.rollback_import_batch(bigint) to authenticated;
commit;
