-- Validate repayments against what the payer individually owes the receiver,
-- rather than either member's collapsed group-wide net balance.

create or replace function public._pairwise_debt(
  p_group_id uuid, p_debtor_id uuid, p_creditor_id uuid, p_exclude_settlement_id uuid default null
) returns bigint
language sql stable security definer set search_path = public as $$
  select (
    coalesce((
      select sum(s.share_amount_paise)
      from expense_splits s
      join expenses e on e.id = s.expense_id
      where e.group_id = p_group_id
        and e.deleted_at is null
        and e.payer_id = p_creditor_id
        and s.member_id = p_debtor_id
    ), 0)
    - coalesce((
      select sum(s.share_amount_paise)
      from expense_splits s
      join expenses e on e.id = s.expense_id
      where e.group_id = p_group_id
        and e.deleted_at is null
        and e.payer_id = p_debtor_id
        and s.member_id = p_creditor_id
    ), 0)
    - coalesce((
      select sum(st.amount_paise)
      from settlements st
      where st.group_id = p_group_id
        and st.status = 'recorded'
        and st.payer_id = p_debtor_id
        and st.receiver_id = p_creditor_id
        and (p_exclude_settlement_id is null or st.id <> p_exclude_settlement_id)
    ), 0)
    + coalesce((
      select sum(st.amount_paise)
      from settlements st
      where st.group_id = p_group_id
        and st.status = 'recorded'
        and st.payer_id = p_creditor_id
        and st.receiver_id = p_debtor_id
        and (p_exclude_settlement_id is null or st.id <> p_exclude_settlement_id)
    ), 0)
  )::bigint;
$$;

revoke all on function public._pairwise_debt(uuid, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.record_settlement(
  p_group_id uuid, p_payer_id uuid, p_receiver_id uuid, p_amount_paise bigint, p_settlement_date date,
  p_note text default null, p_request_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_debt bigint;
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

  v_debt := public._pairwise_debt(p_group_id, p_payer_id, p_receiver_id);
  if v_debt <= 0 then raise exception 'The payer doesn''t owe the receiver anything right now' using errcode = '22023'; end if;
  if p_amount_paise > v_debt then
    raise exception 'That''s more than the payer owes the receiver (₹%)', (v_debt / 100.0)::numeric(14, 2) using errcode = '22023';
  end if;

  insert into settlements (group_id, payer_id, receiver_id, amount_paise, settlement_date, note, created_by, client_request_id)
  values (p_group_id, p_payer_id, p_receiver_id, p_amount_paise, p_settlement_date, nullif(trim(p_note), ''), v_uid, p_request_id)
  returning id into v_id;
  perform _audit(p_group_id, 'settlement', v_id, 'create', null, to_jsonb((select s from settlements s where s.id = v_id)));
  return v_id;
end $$;

create or replace function public.update_settlement(
  p_settlement_id uuid, p_payer_id uuid, p_receiver_id uuid, p_amount_paise bigint,
  p_settlement_date date, p_note text default null, p_expected_updated_at timestamptz default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_s settlements%rowtype;
  v_gid uuid;
  v_prev jsonb;
  v_debt bigint;
begin
  if v_uid is null then raise exception 'Please sign in' using errcode = '28000'; end if;
  select group_id into v_gid from settlements where id = p_settlement_id;
  if v_gid is null or not is_group_member(v_gid) then raise exception 'That repayment doesn''t exist' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtext(v_gid::text));
  select * into v_s from settlements where id = p_settlement_id for update;
  if v_s.status = 'voided' then raise exception 'Voided repayments can''t be edited. Record a new one instead' using errcode = '22023'; end if;
  if v_uid not in (v_s.created_by, v_s.payer_id, v_s.receiver_id) and not is_group_owner(v_gid) then
    raise exception 'Only the people involved or the group owner can edit this repayment' using errcode = '42501';
  end if;
  if p_expected_updated_at is not null and v_s.updated_at <> p_expected_updated_at then
    raise exception 'Someone else changed this repayment. Reload to see the latest version' using errcode = '40001';
  end if;
  if p_payer_id = p_receiver_id then raise exception 'Choose two different people' using errcode = '22023'; end if;
  if p_amount_paise is null or p_amount_paise <= 0 then raise exception 'Enter an amount above zero' using errcode = '22023'; end if;
  if p_settlement_date is null or p_settlement_date > current_date + 1 then
    raise exception 'The repayment date can''t be in the future' using errcode = '22023';
  end if;
  if not exists (select 1 from group_members where group_id = v_gid and user_id = p_payer_id)
     or not exists (select 1 from group_members where group_id = v_gid and user_id = p_receiver_id) then
    raise exception 'Both people must be members of this group' using errcode = '42501';
  end if;

  v_debt := public._pairwise_debt(v_gid, p_payer_id, p_receiver_id, p_settlement_id);
  if v_debt <= 0 then raise exception 'The payer doesn''t owe the receiver anything right now' using errcode = '22023'; end if;
  if p_amount_paise > v_debt then
    raise exception 'That''s more than the payer owes the receiver (₹%)', (v_debt / 100.0)::numeric(14, 2) using errcode = '22023';
  end if;

  v_prev := to_jsonb(v_s);
  update settlements set payer_id = p_payer_id, receiver_id = p_receiver_id, amount_paise = p_amount_paise,
         settlement_date = p_settlement_date, note = nullif(trim(p_note), ''), updated_at = now()
   where id = p_settlement_id;
  perform _audit(v_gid, 'settlement', p_settlement_id, 'update', v_prev, to_jsonb((select s from settlements s where s.id = p_settlement_id)));
end $$;

revoke all on function public.record_settlement(uuid, uuid, uuid, bigint, date, text, uuid) from public, anon;
grant execute on function public.record_settlement(uuid, uuid, uuid, bigint, date, text, uuid) to authenticated;
revoke all on function public.update_settlement(uuid, uuid, uuid, bigint, date, text, timestamptz) from public, anon;
grant execute on function public.update_settlement(uuid, uuid, uuid, bigint, date, text, timestamptz) to authenticated;
