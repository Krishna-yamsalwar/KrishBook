-- =====================================================================
-- SplitLedger schema, RLS and server-side logic
-- Run once in the Supabase SQL editor (or `supabase db push`) as the postgres role.
-- All money is integer paise. All writes go through SECURITY DEFINER functions
-- that re-check membership, so the browser never writes to tables directly.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- tables ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 60),
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

create table public.group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  description text not null check (char_length(trim(description)) between 1 and 120),
  total_amount_paise bigint not null check (total_amount_paise > 0),
  payer_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  expense_date date not null,
  split_method text not null check (split_method in ('equal', 'percentage', 'manual', 'weighted')),
  category text check (category is null or char_length(category) <= 40),
  client_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index expenses_group_date_idx on public.expenses (group_id, expense_date desc) where deleted_at is null;
create unique index expenses_idem_idx on public.expenses (created_by, client_request_id) where client_request_id is not null;

create table public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  member_id uuid not null references public.profiles(id),
  share_amount_paise bigint not null check (share_amount_paise >= 0),
  percentage numeric(9, 4),
  weight numeric(12, 4),
  created_at timestamptz not null default now(),
  unique (expense_id, member_id)
);
create index expense_splits_member_idx on public.expense_splits (member_id);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  payer_id uuid not null references public.profiles(id),
  receiver_id uuid not null references public.profiles(id),
  amount_paise bigint not null check (amount_paise > 0),
  settlement_date date not null,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid not null references public.profiles(id),
  client_request_id uuid,
  -- 'recorded' = a member says it happened. Nothing here is verified against UPI.
  status text not null default 'recorded' check (status in ('recorded', 'voided')),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (payer_id <> receiver_id)
);
create index settlements_group_idx on public.settlements (group_id, settlement_date desc);
create unique index settlements_idem_idx on public.settlements (created_by, client_request_id) where client_request_id is not null;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  actor_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  previous_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);
create index audit_entity_idx on public.audit_logs (entity_id, created_at desc);
create index audit_group_idx on public.audit_logs (group_id, created_at desc);

-- ---------- helpers used by RLS ----------
create or replace function public.is_group_member(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = p_group and user_id = auth.uid());
$$;

create or replace function public.is_group_owner(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = p_group and user_id = auth.uid() and role = 'owner');
$$;

create or replace function public.shares_group_with(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_members a join group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = p_user);
$$;

-- ---------- profile bootstrap ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Member'), 60));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RLS: members can read their groups; nobody writes directly ----------
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invitations enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy groups_select on public.groups for select to authenticated using (public.is_group_member(id));
create policy members_select on public.group_members for select to authenticated using (public.is_group_member(group_id));
create policy expenses_select on public.expenses for select to authenticated using (public.is_group_member(group_id));
create policy splits_select on public.expense_splits for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_group_member(e.group_id)));
create policy settlements_select on public.settlements for select to authenticated using (public.is_group_member(group_id));
create policy audit_select on public.audit_logs for select to authenticated using (public.is_group_member(group_id));
-- group_invitations: no policy = no client access. Tokens are only handled by functions.

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ---------- internal functions ----------
create or replace function public._audit(p_group uuid, p_type text, p_entity uuid, p_action text, p_prev jsonb, p_new jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_logs (group_id, actor_id, entity_type, entity_id, action, previous_values, new_values)
  values (p_group, auth.uid(), p_type, p_entity, p_action, p_prev, p_new);
$$;

create or replace function public._expense_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(e) || jsonb_build_object('splits', coalesce((
    select jsonb_agg(jsonb_build_object('member_id', s.member_id, 'share_amount_paise', s.share_amount_paise,
                                        'percentage', s.percentage, 'weight', s.weight) order by s.member_id)
    from expense_splits s where s.expense_id = e.id), '[]'::jsonb))
  from expenses e where e.id = p_id;
$$;

-- Deterministic split engine (largest-remainder). Ties on the fractional part go to the
-- lowest member id, so the same input always gives the same paise. Mirrors src/lib/money.ts.
create or replace function public._compute_splits(p_total bigint, p_method text, p_inputs jsonb)
returns table (member_id uuid, share bigint, pct numeric, wt numeric)
language plpgsql stable set search_path = public as $$
declare
  v_sum numeric; v_bad boolean; v_cnt bigint; v_dist bigint;
begin
  if p_inputs is null or jsonb_typeof(p_inputs) <> 'array' or jsonb_array_length(p_inputs) = 0 then
    raise exception 'Pick at least one person to split with' using errcode = '22023';
  end if;

  if p_method = 'manual' then
    select sum((e ->> 'value')::numeric), bool_or((e ->> 'value') is null or (e ->> 'value')::numeric <= 0
             or (e ->> 'value')::numeric <> trunc((e ->> 'value')::numeric)),
           count(*), count(distinct e ->> 'member_id')
      into v_sum, v_bad, v_cnt, v_dist
      from jsonb_array_elements(p_inputs) e;
    if v_cnt <> v_dist then raise exception 'Each person can only appear once' using errcode = '22023'; end if;
    if v_bad then raise exception 'Every share must be a whole number of paise above zero' using errcode = '22023'; end if;
    if v_sum <> p_total then
      raise exception 'Shares add up to % paise but the total is % paise', v_sum, p_total using errcode = '22023';
    end if;
    return query
      select (e ->> 'member_id')::uuid, (e ->> 'value')::bigint, null::numeric, null::numeric
      from jsonb_array_elements(p_inputs) e;
    return;
  end if;

  select sum(case p_method when 'equal' then 1::numeric else (e ->> 'value')::numeric end),
         bool_or(p_method <> 'equal' and ((e ->> 'value') is null or (e ->> 'value')::numeric <= 0)),
         count(*), count(distinct e ->> 'member_id')
    into v_sum, v_bad, v_cnt, v_dist
    from jsonb_array_elements(p_inputs) e;
  if v_cnt <> v_dist then raise exception 'Each person can only appear once' using errcode = '22023'; end if;
  if v_bad then raise exception 'Every selected person needs a value above zero' using errcode = '22023'; end if;
  if p_method = 'percentage' and v_sum <> 100 then
    raise exception 'Percentages add up to % but must total exactly 100', v_sum using errcode = '22023';
  end if;

  return query
    with raw as (
      select (e ->> 'member_id')::uuid as mid,
             case p_method when 'equal' then 1::numeric else (e ->> 'value')::numeric end as w
      from jsonb_array_elements(p_inputs) e),
    base as (
      select mid, w, (p_total * w - mod(p_total * w, v_sum)) / v_sum as fl, mod(p_total * w, v_sum) as frac from raw),
    ranked as (
      select mid, w, fl, row_number() over (order by frac desc, mid asc) as rn from base)
    select mid,
           (fl + case when rn <= (p_total - (select sum(fl) from ranked)) then 1 else 0 end)::bigint,
           case when p_method = 'percentage' then w end,
           case when p_method = 'weighted' then w end
    from ranked;
end $$;

create or replace function public._validate_expense(p_group uuid, p_description text, p_total bigint, p_payer uuid,
                                                    p_date date, p_method text, p_inputs jsonb)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_description is null or not (char_length(trim(p_description)) between 1 and 120) then
    raise exception 'Add a short description (up to 120 characters)' using errcode = '22023';
  end if;
  if p_total is null or p_total <= 0 or p_total > 1000000000000 then
    raise exception 'Enter an amount above zero' using errcode = '22023';
  end if;
  if p_date is null or p_date > current_date + 1 then
    raise exception 'The expense date can''t be in the future' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('equal', 'percentage', 'manual', 'weighted') then
    raise exception 'Unknown split method' using errcode = '22023';
  end if;
  if p_inputs is null or jsonb_typeof(p_inputs) <> 'array' then
    raise exception 'Pick at least one person to split with' using errcode = '22023';
  end if;
  if not exists (select 1 from group_members where group_id = p_group and user_id = p_payer) then
    raise exception 'The payer isn''t a member of this group' using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_array_elements(p_inputs) e
             where not exists (select 1 from group_members gm
                               where gm.group_id = p_group and gm.user_id = (e ->> 'member_id')::uuid)) then
    raise exception 'Someone in this split isn''t a member of the group' using errcode = '42501';
  end if;
end $$;

-- ---------- public API (called with supabase.rpc) ----------
create or replace function public.create_group(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'Please sign in' using errcode = '28000'; end if;
  if p_name is null or not (char_length(trim(p_name)) between 1 and 80) then
    raise exception 'Give the group a name (up to 80 characters)' using errcode = '22023';
  end if;
  insert into groups (name, created_by) values (trim(p_name), v_uid) returning id into v_id;
  insert into group_members (group_id, user_id, role) values (v_id, v_uid, 'owner');
  perform _audit(v_id, 'group', v_id, 'create', null, jsonb_build_object('name', trim(p_name)));
  return v_id;
end $$;

create or replace function public.create_invitation(p_group_id uuid, p_valid_hours int default 72) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in' using errcode = '28000'; end if;
  if not is_group_owner(p_group_id) then
    raise exception 'Only the group owner can create invites' using errcode = '42501';
  end if;
  v_token := encode(extensions.gen_random_bytes(18), 'hex');
  insert into group_invitations (group_id, token_hash, created_by, expires_at)
  values (p_group_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid(),
          now() + make_interval(hours => greatest(1, least(coalesce(p_valid_hours, 72), 720))))
  returning id into v_id;
  perform _audit(p_group_id, 'invitation', v_id, 'create', null, null);
  return v_token;
end $$;

create or replace function public.join_group(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_inv group_invitations%rowtype;
begin
  if v_uid is null then raise exception 'Please sign in' using errcode = '28000'; end if;
  select * into v_inv from group_invitations
   where token_hash = encode(extensions.digest(trim(coalesce(p_token, '')), 'sha256'), 'hex') for update;
  if not found then raise exception 'This invite link isn''t valid' using errcode = '22023'; end if;
  if exists (select 1 from group_members where group_id = v_inv.group_id and user_id = v_uid) then
    return v_inv.group_id;
  end if;
  if v_inv.used_at is not null then raise exception 'This invite has already been used' using errcode = '22023'; end if;
  if v_inv.expires_at < now() then raise exception 'This invite has expired. Ask for a new one' using errcode = '22023'; end if;
  insert into group_members (group_id, user_id, role) values (v_inv.group_id, v_uid, 'member');
  update group_invitations set used_at = now(), used_by = v_uid where id = v_inv.id;
  perform _audit(v_inv.group_id, 'member', v_uid, 'join', null, jsonb_build_object('user_id', v_uid));
  return v_inv.group_id;
end $$;

create or replace function public.create_expense(
  p_group_id uuid, p_description text, p_total_paise bigint, p_payer_id uuid, p_expense_date date,
  p_split_method text, p_category text, p_inputs jsonb, p_request_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'Please sign in' using errcode = '28000'; end if;
  if not is_group_member(p_group_id) then raise exception 'You''re not a member of this group' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_group_id::text));
  if p_request_id is not null then
    select id into v_id from expenses where created_by = v_uid and client_request_id = p_request_id;
    if found then return v_id; end if;  -- double-click / retry: return the original
  end if;
  perform _validate_expense(p_group_id, p_description, p_total_paise, p_payer_id, p_expense_date, p_split_method, p_inputs);
  insert into expenses (group_id, description, total_amount_paise, payer_id, created_by, expense_date, split_method, category, client_request_id)
  values (p_group_id, trim(p_description), p_total_paise, p_payer_id, v_uid, p_expense_date, p_split_method, nullif(trim(p_category), ''), p_request_id)
  returning id into v_id;
  insert into expense_splits (expense_id, member_id, share_amount_paise, percentage, weight)
  select v_id, s.member_id, s.share, s.pct, s.wt from _compute_splits(p_total_paise, p_split_method, p_inputs) s;
  perform _audit(p_group_id, 'expense', v_id, 'create', null, _expense_snapshot(v_id));
  return v_id;
end $$;

create or replace function public.update_expense(
  p_expense_id uuid, p_description text, p_total_paise bigint, p_payer_id uuid, p_expense_date date,
  p_split_method text, p_category text, p_inputs jsonb, p_expected_updated_at timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_gid uuid; v_e expenses%rowtype; v_prev jsonb;
begin
  if v_uid is null then raise exception 'Please sign in' using errcode = '28000'; end if;
  select group_id into v_gid from expenses where id = p_expense_id and deleted_at is null;
  if v_gid is null then raise exception 'That expense no longer exists' using errcode = 'P0002'; end if;
  if not is_group_member(v_gid) then raise exception 'You''re not a member of this group' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(v_gid::text));
  select * into v_e from expenses where id = p_expense_id and deleted_at is null for update;
  if not found then raise exception 'That expense no longer exists' using errcode = 'P0002'; end if;
  if v_e.created_by <> v_uid and not is_group_owner(v_gid) then
    raise exception 'Only the person who added this expense or the group owner can edit it' using errcode = '42501';
  end if;
  if p_expected_updated_at is not null and v_e.updated_at <> p_expected_updated_at then
    raise exception 'Someone else changed this expense. Reload to see the latest version' using errcode = '40001';
  end if;
  perform _validate_expense(v_gid, p_description, p_total_paise, p_payer_id, p_expense_date, p_split_method, p_inputs);
  v_prev := _expense_snapshot(p_expense_id);
  update expenses set description = trim(p_description), total_amount_paise = p_total_paise, payer_id = p_payer_id,
         expense_date = p_expense_date, split_method = p_split_method, category = nullif(trim(p_category), ''), updated_at = now()
   where id = p_expense_id;
  delete from expense_splits where expense_id = p_expense_id;
  insert into expense_splits (expense_id, member_id, share_amount_paise, percentage, weight)
  select p_expense_id, s.member_id, s.share, s.pct, s.wt from _compute_splits(p_total_paise, p_split_method, p_inputs) s;
  perform _audit(v_gid, 'expense', p_expense_id, 'update', v_prev, _expense_snapshot(p_expense_id));
end $$;

create or replace function public.delete_expense(p_expense_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_gid uuid; v_e expenses%rowtype;
begin
  if v_uid is null then raise exception 'Please sign in' using errcode = '28000'; end if;
  select group_id into v_gid from expenses where id = p_expense_id and deleted_at is null;
  if v_gid is null then raise exception 'That expense no longer exists' using errcode = 'P0002'; end if;
  if not is_group_member(v_gid) then raise exception 'You''re not a member of this group' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(v_gid::text));
  select * into v_e from expenses where id = p_expense_id and deleted_at is null for update;
  if not found then raise exception 'That expense no longer exists' using errcode = 'P0002'; end if;
  if v_e.created_by <> v_uid and not is_group_owner(v_gid) then
    raise exception 'Only the person who added this expense or the group owner can delete it' using errcode = '42501';
  end if;
  perform _audit(v_gid, 'expense', p_expense_id, 'delete', _expense_snapshot(p_expense_id), null);
  update expenses set deleted_at = now(), updated_at = now() where id = p_expense_id;
end $$;

-- Net = paid - shares + repayments you made - repayments you received.
-- (A repayment you make reduces what you owe, so it moves your net UP.)
create or replace function public.group_balances(p_group_id uuid)
returns table (user_id uuid, paid_paise bigint, share_paise bigint, settled_out_paise bigint, settled_in_paise bigint, net_paise bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_group_member(p_group_id) then raise exception 'You''re not a member of this group' using errcode = '42501'; end if;
  return query
  with t as (
    select gm.user_id as uid,
      coalesce((select sum(e.total_amount_paise) from expenses e
                where e.group_id = p_group_id and e.deleted_at is null and e.payer_id = gm.user_id), 0) as paid,
      coalesce((select sum(s.share_amount_paise) from expense_splits s join expenses e on e.id = s.expense_id
                where e.group_id = p_group_id and e.deleted_at is null and s.member_id = gm.user_id), 0) as share,
      coalesce((select sum(st.amount_paise) from settlements st
                where st.group_id = p_group_id and st.status = 'recorded' and st.payer_id = gm.user_id), 0) as sout,
      coalesce((select sum(st.amount_paise) from settlements st
                where st.group_id = p_group_id and st.status = 'recorded' and st.receiver_id = gm.user_id), 0) as sin
    from group_members gm where gm.group_id = p_group_id)
  select t.uid, t.paid::bigint, t.share::bigint, t.sout::bigint, t.sin::bigint, (t.paid - t.share + t.sout - t.sin)::bigint
  from t order by t.uid;
end $$;

create or replace function public.record_settlement(
  p_group_id uuid, p_payer_id uuid, p_receiver_id uuid, p_amount_paise bigint, p_settlement_date date,
  p_note text default null, p_request_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_pn bigint; v_rn bigint;
begin
  if v_uid is null then raise exception 'Please sign in' using errcode = '28000'; end if;
  if not is_group_member(p_group_id) then raise exception 'You''re not a member of this group' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_group_id::text));
  if p_request_id is not null then
    select id into v_id from settlements where created_by = v_uid and client_request_id = p_request_id;
    if found then return v_id; end if;
  end if;
  if v_uid not in (p_payer_id, p_receiver_id) then
    raise exception 'You can only record repayments you made or received' using errcode = '42501';
  end if;
  if p_payer_id = p_receiver_id then raise exception 'Choose two different people' using errcode = '22023'; end if;
  if p_amount_paise is null or p_amount_paise <= 0 then raise exception 'Enter an amount above zero' using errcode = '22023'; end if;
  if p_settlement_date is null or p_settlement_date > current_date + 1 then
    raise exception 'The repayment date can''t be in the future' using errcode = '22023';
  end if;
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = p_payer_id)
     or not exists (select 1 from group_members where group_id = p_group_id and user_id = p_receiver_id) then
    raise exception 'Both people must be members of this group' using errcode = '42501';
  end if;
  select b.net_paise into v_pn from group_balances(p_group_id) b where b.user_id = p_payer_id;
  select b.net_paise into v_rn from group_balances(p_group_id) b where b.user_id = p_receiver_id;
  if v_pn >= 0 then raise exception 'The payer doesn''t owe anything right now' using errcode = '22023'; end if;
  if p_amount_paise > -v_pn then
    raise exception 'That''s more than the payer owes (₹%)', (-v_pn / 100.0)::numeric(14, 2) using errcode = '22023';
  end if;
  if v_rn <= 0 or p_amount_paise > v_rn then
    raise exception 'That''s more than the receiver is owed (₹%)', (greatest(v_rn, 0) / 100.0)::numeric(14, 2) using errcode = '22023';
  end if;
  insert into settlements (group_id, payer_id, receiver_id, amount_paise, settlement_date, note, created_by, client_request_id)
  values (p_group_id, p_payer_id, p_receiver_id, p_amount_paise, p_settlement_date, nullif(trim(p_note), ''), v_uid, p_request_id)
  returning id into v_id;
  perform _audit(p_group_id, 'settlement', v_id, 'create', null, to_jsonb((select s from settlements s where s.id = v_id)));
  return v_id;
end $$;

create or replace function public.void_settlement(p_settlement_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_s settlements%rowtype;
begin
  if v_uid is null then raise exception 'Please sign in' using errcode = '28000'; end if;
  select group_id into v_s.group_id from settlements where id = p_settlement_id;
  if v_s.group_id is null or not is_group_member(v_s.group_id) then
    raise exception 'That repayment doesn''t exist' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_s.group_id::text));
  select * into v_s from settlements where id = p_settlement_id for update;
  if v_s.status = 'voided' then return; end if;
  if v_uid not in (v_s.created_by, v_s.payer_id, v_s.receiver_id) and not is_group_owner(v_s.group_id) then
    raise exception 'Only the people involved or the group owner can void this' using errcode = '42501';
  end if;
  update settlements set status = 'voided', voided_at = now(), voided_by = v_uid where id = p_settlement_id;
  perform _audit(v_s.group_id, 'settlement', p_settlement_id, 'void', to_jsonb(v_s), null);
end $$;

-- ---------- privileges ----------
revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public._audit(uuid, text, uuid, text, jsonb, jsonb) from authenticated;
revoke execute on function public._expense_snapshot(uuid) from authenticated;
revoke execute on function public._compute_splits(bigint, text, jsonb) from authenticated;
revoke execute on function public._validate_expense(uuid, text, bigint, uuid, date, text, jsonb) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;

-- ---------- realtime (RLS still applies to what each client receives) ----------
alter publication supabase_realtime add table public.expenses, public.expense_splits, public.settlements, public.group_members;
