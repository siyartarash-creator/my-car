begin;
-- MY CAR Map/Navigation Phase 2, item C: road event reports.
--
-- Reuses the existing Part 1 community-report -> admin-review ->
-- map_features pipeline untouched; no new tables. A road_event report
-- follows the exact same path as any other community report (stays
-- 'pending' on promotion, requires a separate admin verification step
-- before it is publicly visible) -- safety-relevant data does not get a
-- shortcut just because it is time-sensitive.
--
-- This migration closes a real gap: map_features.expires_at has existed
-- since Part 1, but map_feature_read never actually checked it, so an
-- expired verified feature would have stayed publicly visible forever.
-- That is a bounded correction to an existing policy, not new surface.
insert into public.map_poi_categories (slug, name_fa, name_en, icon, is_active) values
  ('road_event', 'رویداد جاده‌ای', 'Road event', 'alert-triangle', true);

drop policy if exists map_feature_read on public.map_features;
create policy map_feature_read on public.map_features for select to anon, authenticated using (
  (status = 'verified' and (expires_at is null or expires_at > now()))
  or submitted_by = auth.uid()
  or private.is_admin());

-- review_community_report now gives a road_event promotion a conservative
-- 12-hour default expiry, so a stale hazard pin can't linger indefinitely
-- just because nobody cleared it; every other category keeps the Part 1
-- behaviour (no expiry). This replaces the function body on its EXACT
-- original (bigint,text,text) signature -- deliberately not adding a new
-- parameter. An earlier draft of this migration added an optional
-- p_expires_at admin-override parameter; applying that to STAGING created
-- a second (bigint,text,text,timestamptz) overload that made every 3-arg
-- call ambiguous ("function ... is not unique"), breaking this RPC for
-- any caller -- including PostgREST, which matches by parameter name, not
-- just position. Caught and fixed during the same STAGING verification
-- pass (the orphaned overload was renamed out of the way there, since
-- DROP FUNCTION requires interactive operator confirmation this
-- environment cannot give). Kept here as the corrected, single-signature
-- version so a fresh database never creates that overload in the first
-- place.
create or replace function public.review_community_report(
  p_report_id bigint, p_decision text, p_note text
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare rpt record; src_id bigint; feature_id bigint; category_slug text; effective_expiry timestamptz;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if p_decision not in ('promoted','rejected') then raise exception 'invalid_decision'; end if;
  select * into rpt from public.map_community_reports where id = p_report_id and status = 'pending';
  if rpt is null then raise exception 'report_not_found'; end if;
  if p_decision = 'promoted' then
    select id into src_id from public.map_sources where code = 'community';
    select slug into category_slug from public.map_poi_categories
      where id = coalesce(rpt.category_id, (select id from public.map_poi_categories where slug = 'other'));
    effective_expiry := case when category_slug = 'road_event' then now() + interval '12 hours' else null end;
    insert into public.map_features(category_id, source_id, name_fa, lat, lng, status, confidence, submitted_by, expires_at)
    values (coalesce(rpt.category_id, (select id from public.map_poi_categories where slug = 'other')), src_id,
      coalesce(rpt.description, 'Community report'), rpt.lat, rpt.lng, 'pending', 0.3, rpt.reporter_id, effective_expiry)
    returning id into feature_id;
    insert into public.map_feature_provenance(feature_id, action, actor, source_id, note)
    values (feature_id, 'created', auth.uid(), src_id, p_note);
  end if;
  update public.map_community_reports set status = p_decision, promoted_feature_id = feature_id,
    reviewed_by = auth.uid(), reviewed_at = now() where id = p_report_id;
  return p_report_id;
end $$;
revoke all on function public.review_community_report(bigint, text, text) from public, anon, authenticated;
grant execute on function public.review_community_report(bigint, text, text) to authenticated;
commit;
