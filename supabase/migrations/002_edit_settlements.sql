-- Adds editing for repayments. Run after 001. Same rules as expenses:
-- creator, the two people involved, or the group owner can edit; every change is audited.

alter table public.settlements add column if not exists updated_at timestamptz not null default now();

create or replace function public.update_settlement(
  p_settlement_id uuid, p_payer_id uuid, p_receiver_id uuid, p_amount_paise bigint,
  p_settlement_date date, p_note text default null, p_expected_updated_at timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_s settlements%rowtype; v_gid uuid; v_prev jsonb; v_pn bigint; v_rn bigint;
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

  -- Balances as they'd be if this repayment didn't exist yet, then apply the same checks as a new one.
  select b.net_paise - case when p_payer_id = v_s.payer_id then v_s.amount_paise else 0 end
                     + case when p_payer_id = v_s.receiver_id then v_s.amount_paise else 0 end
    into v_pn from group_balances(v_gid) b where b.user_id = p_payer_id;
  select b.net_paise + case when p_receiver_id = v_s.receiver_id then v_s.amount_paise else 0 end
                     - case when p_receiver_id = v_s.payer_id then v_s.amount_paise else 0 end
    into v_rn from group_balances(v_gid) b where b.user_id = p_receiver_id;
  if v_pn >= 0 then raise exception 'The payer doesn''t owe anything right now' using errcode = '22023'; end if;
  if p_amount_paise > -v_pn then
    raise exception 'That''s more than the payer owes (₹%)', (-v_pn / 100.0)::numeric(14, 2) using errcode = '22023';
  end if;
  if v_rn <= 0 or p_amount_paise > v_rn then
    raise exception 'That''s more than the receiver is owed (₹%)', (greatest(v_rn, 0) / 100.0)::numeric(14, 2) using errcode = '22023';
  end if;

  v_prev := to_jsonb(v_s);
  update settlements set payer_id = p_payer_id, receiver_id = p_receiver_id, amount_paise = p_amount_paise,
         settlement_date = p_settlement_date, note = nullif(trim(p_note), ''), updated_at = now()
   where id = p_settlement_id;
  perform _audit(v_gid, 'settlement', p_settlement_id, 'update', v_prev, to_jsonb((select s from settlements s where s.id = p_settlement_id)));
end $$;

revoke all on function public.update_settlement(uuid, uuid, uuid, bigint, date, text, timestamptz) from public, anon;
grant execute on function public.update_settlement(uuid, uuid, uuid, bigint, date, text, timestamptz) to authenticated;
