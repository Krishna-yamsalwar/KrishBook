-- =====================================================================
-- 003_open_invites.sql
-- Adds multi-use invite links (anyone with the link can join) and
-- 6-digit short codes. Both can be created by any group member.
-- =====================================================================

-- Add columns to group_invitations
alter table public.group_invitations
  add column if not exists invite_type text not null default 'single_use'
    check (invite_type in ('single_use', 'open', 'short_code')),
  add column if not exists short_code text,
  add column if not exists use_count int not null default 0;

create unique index if not exists group_invitations_short_code_idx
  on public.group_invitations (short_code) where short_code is not null;

-- Helper: generate a unique 6-digit code
create or replace function public._gen_short_code() returns text
language plpgsql security definer set search_path = public as $$
declare v_code text; v_tries int := 0;
begin
  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (
      select 1 from group_invitations
      where short_code = v_code and expires_at > now()
    );
    v_tries := v_tries + 1;
    if v_tries > 20 then raise exception 'Could not generate unique code, try again'; end if;
  end loop;
  return v_code;
end $$;

-- Create an open (multi-use) invite link — any member can call this
create or replace function public.create_open_invitation(p_group_id uuid, p_valid_hours int default 168) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in' using errcode = '28000'; end if;
  if not is_group_member(p_group_id) then
    raise exception 'You must be a member to create an invite' using errcode = '42501';
  end if;
  v_token := encode(extensions.gen_random_bytes(18), 'hex');
  insert into group_invitations (group_id, token_hash, created_by, expires_at, invite_type)
  values (p_group_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid(),
          now() + make_interval(hours => greatest(1, least(coalesce(p_valid_hours, 168), 720))),
          'open')
  returning id into v_id;
  perform _audit(p_group_id, 'invitation', v_id, 'create_open', null, null);
  return v_token;
end $$;

-- Create a 6-digit short code — any member can call this
create or replace function public.create_short_code(p_group_id uuid, p_valid_hours int default 168) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in' using errcode = '28000'; end if;
  if not is_group_member(p_group_id) then
    raise exception 'You must be a member to create an invite' using errcode = '42501';
  end if;
  v_code := _gen_short_code();
  insert into group_invitations (group_id, token_hash, created_by, expires_at, invite_type, short_code)
  values (p_group_id, encode(extensions.digest(v_code, 'sha256'), 'hex'), auth.uid(),
          now() + make_interval(hours => greatest(1, least(coalesce(p_valid_hours, 168), 720))),
          'short_code', v_code)
  returning id into v_id;
  perform _audit(p_group_id, 'invitation', v_id, 'create_short_code', null, null);
  return v_code;
end $$;

-- Update join_group to handle open (multi-use) links
create or replace function public.join_group(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_inv group_invitations%rowtype;
begin
  if v_uid is null then raise exception 'Please sign in' using errcode = '28000'; end if;
  select * into v_inv from group_invitations
   where token_hash = encode(extensions.digest(trim(coalesce(p_token, '')), 'sha256'), 'hex')
     and invite_type in ('single_use', 'open')
   for update;
  if not found then raise exception 'This invite link isn''t valid' using errcode = '22023'; end if;
  if v_inv.expires_at < now() then raise exception 'This invite has expired. Ask for a new one' using errcode = '22023'; end if;
  -- already a member: just return the group
  if exists (select 1 from group_members where group_id = v_inv.group_id and user_id = v_uid) then
    return v_inv.group_id;
  end if;
  -- single-use: check not already used
  if v_inv.invite_type = 'single_use' and v_inv.used_at is not null then
    raise exception 'This invite has already been used' using errcode = '22023';
  end if;
  insert into group_members (group_id, user_id, role) values (v_inv.group_id, v_uid, 'member');
  update group_invitations
     set use_count = use_count + 1,
         used_at   = case when invite_type = 'single_use' then now() else used_at end,
         used_by   = case when invite_type = 'single_use' then v_uid  else used_by  end
   where id = v_inv.id;
  perform _audit(v_inv.group_id, 'member', v_uid, 'join', null, jsonb_build_object('user_id', v_uid));
  return v_inv.group_id;
end $$;

-- Join by 6-digit code
create or replace function public.join_group_by_code(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_inv group_invitations%rowtype;
begin
  if v_uid is null then raise exception 'Please sign in' using errcode = '28000'; end if;
  select * into v_inv from group_invitations
   where short_code = trim(coalesce(p_code, ''))
     and invite_type = 'short_code'
   for update;
  if not found then raise exception 'That code isn''t valid. Check it and try again.' using errcode = '22023'; end if;
  if v_inv.expires_at < now() then raise exception 'This code has expired. Ask for a new one.' using errcode = '22023'; end if;
  if exists (select 1 from group_members where group_id = v_inv.group_id and user_id = v_uid) then
    return v_inv.group_id;
  end if;
  insert into group_members (group_id, user_id, role) values (v_inv.group_id, v_uid, 'member');
  update group_invitations set use_count = use_count + 1 where id = v_inv.id;
  perform _audit(v_inv.group_id, 'member', v_uid, 'join_by_code', null, jsonb_build_object('user_id', v_uid));
  return v_inv.group_id;
end $$;

-- Grant execute to authenticated users
grant execute on function public.create_open_invitation(uuid, int) to authenticated;
grant execute on function public.create_short_code(uuid, int) to authenticated;
grant execute on function public.join_group_by_code(text) to authenticated;
revoke execute on function public._gen_short_code() from authenticated;
