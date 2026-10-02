-- Automotive foundation (Track B, Milestone 1/2). Reconciled into the
-- canonical migration sequence after Store Phase 5 completed: Phase 5's
-- last migration is 202610020001_admin_order_item_read.sql, so this
-- timestamp (202610021000) is confirmed non-colliding and ordered after it.
--
-- Track B owns this file exclusively. Do not edit from Store work.

-- vehicles: minimal owner-scoped vehicle domain. No VIN in V1 (no concrete
-- need yet). Ownership always derives from auth.uid(), never a client value.
create table public.vehicles (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  make text not null check (char_length(make) between 1 and 60),
  model text not null check (char_length(model) between 1 and 60),
  year int not null check (year between 1950 and 2100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.vehicles enable row level security;
revoke all on public.vehicles from public, anon, authenticated;
grant select, insert, update, delete on public.vehicles to authenticated;
grant usage, select on sequence public.vehicles_id_seq to authenticated;

create policy vehicle_read on public.vehicles for select to authenticated
  using (profile_id = auth.uid() or private.is_admin());
create policy vehicle_write on public.vehicles for insert to authenticated
  with check (profile_id = auth.uid());
create policy vehicle_update on public.vehicles for update to authenticated
  using (profile_id = auth.uid() or private.is_admin())
  with check (profile_id = auth.uid() or private.is_admin());
create policy vehicle_delete on public.vehicles for delete to authenticated
  using (profile_id = auth.uid() or private.is_admin());

-- automotive_knowledge_sources: provenance registry. Source identity must
-- never blend with content -- every knowledge entry points at exactly one
-- source row, and the source's type is the single fact that decides how
-- trustworthy the entry is allowed to look.
create table public.automotive_knowledge_sources (
  id bigint generated always as identity primary key,
  source_type text not null check (source_type in
    ('manufacturer','trusted_technical_source','mechanic_authored','ai_inferred')),
  name text not null check (char_length(name) between 1 and 120),
  description text,
  authored_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.automotive_knowledge_sources enable row level security;
revoke all on public.automotive_knowledge_sources from public, anon, authenticated;
grant select on public.automotive_knowledge_sources to authenticated;
grant insert, update on public.automotive_knowledge_sources to authenticated;
grant usage, select on sequence public.automotive_knowledge_sources_id_seq to authenticated;

create policy knowledge_source_read on public.automotive_knowledge_sources
  for select to authenticated using (true);
create policy knowledge_source_write on public.automotive_knowledge_sources
  for insert to authenticated with check (private.is_admin());
create policy knowledge_source_update on public.automotive_knowledge_sources
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

-- automotive_knowledge_entries: the practical, single-table knowledge model.
-- Normalizing system/subsystem/component/symptom/cause/test/action into
-- separate tables would add joins without adding real integrity here, so
-- they stay as columns on one understandable row.
--
-- Provenance integrity is structural, not conventional: review_status can
-- only reach 'published' once reviewed_by/reviewed_at are set by a human
-- profile, so an ai_inferred row can never silently become verified fact --
-- someone has to look at it and sign off first.
create table public.automotive_knowledge_entries (
  id bigint generated always as identity primary key,
  source_id bigint not null references public.automotive_knowledge_sources(id),
  system text not null check (char_length(system) between 1 and 80),
  subsystem text,
  component text,
  symptom text not null check (char_length(symptom) between 1 and 300),
  possible_cause text not null check (char_length(possible_cause) between 1 and 500),
  diagnostic_test text,
  expected_result text,
  repair_action text,
  -- vehicle applicability: array of {make?, model?, year_from?, year_to?}.
  -- Empty array/null means "applies broadly" (not vehicle-specific).
  vehicle_applicability jsonb not null default '[]'::jsonb,
  confidence text not null check (confidence in ('low','medium','high')),
  risk_level text not null check (risk_level in
    ('informational','routine_safe','requires_caution','safety_critical')),
  review_status text not null default 'draft' check (review_status in ('draft','reviewed','published')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  is_fixture boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_requires_human_review check (
    review_status <> 'published' or (reviewed_by is not null and reviewed_at is not null)
  )
);
alter table public.automotive_knowledge_entries enable row level security;
revoke all on public.automotive_knowledge_entries from public, anon, authenticated;
grant select on public.automotive_knowledge_entries to authenticated;
grant insert, update on public.automotive_knowledge_entries to authenticated;
grant usage, select on sequence public.automotive_knowledge_entries_id_seq to authenticated;

-- Published, non-fixture entries are readable by any authenticated user
-- (this is the internal retrieval surface); drafts/fixtures/reviews stay
-- visible only to their author or an admin.
create policy knowledge_entry_read on public.automotive_knowledge_entries for select to authenticated
  using (
    (review_status = 'published' and is_fixture is false)
    or private.is_admin()
    or exists (
      select 1 from public.automotive_knowledge_sources s
      where s.id = source_id and s.authored_by = auth.uid()
    )
  );
create policy knowledge_entry_write on public.automotive_knowledge_entries for insert to authenticated
  with check (private.is_admin() or exists (
    select 1 from public.automotive_knowledge_sources s
    where s.id = source_id and s.authored_by = auth.uid()
  ));
create policy knowledge_entry_update on public.automotive_knowledge_entries for update to authenticated
  using (private.is_admin())
  with check (
    private.is_admin()
    and (review_status <> 'published' or (reviewed_by is not null and reviewed_at is not null))
  );

-- automotive_case_intake: Mehdi's raw diagnostic/repair experience, captured
-- before it becomes reusable knowledge. A case moves draft -> reviewed ->
-- published; publishing links it to the knowledge entry it produced.
create table public.automotive_case_intake (
  id bigint generated always as identity primary key,
  author_profile_id uuid not null references public.profiles(id),
  vehicle_applicability jsonb not null default '[]'::jsonb,
  observed text not null check (char_length(observed) between 1 and 2000),
  diagnosis text not null check (char_length(diagnosis) between 1 and 2000),
  diagnostic_test text,
  resolution text not null check (char_length(resolution) between 1 and 2000),
  uncertainty_notes text,
  safety_notes text,
  status text not null default 'draft' check (status in ('draft','reviewed','published')),
  published_entry_id bigint references public.automotive_knowledge_entries(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_case_has_entry check (status <> 'published' or published_entry_id is not null)
);
alter table public.automotive_case_intake enable row level security;
revoke all on public.automotive_case_intake from public, anon, authenticated;
grant select, insert, update on public.automotive_case_intake to authenticated;
grant usage, select on sequence public.automotive_case_intake_id_seq to authenticated;

create policy case_intake_read on public.automotive_case_intake for select to authenticated
  using (author_profile_id = auth.uid() or private.is_admin());
create policy case_intake_write on public.automotive_case_intake for insert to authenticated
  with check (author_profile_id = auth.uid());
create policy case_intake_update on public.automotive_case_intake for update to authenticated
  using (author_profile_id = auth.uid() or private.is_admin())
  with check (
    (author_profile_id = auth.uid() and status = 'draft')
    or private.is_admin()
  );
