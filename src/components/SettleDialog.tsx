import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useGroup } from './GroupLayout';
import { Btn, ErrorNote, Field, Modal, useToast } from './ui';
import { formatINR, paiseToInput, parseINR } from '../lib/money';
import { computeNets, maxSettlementAmount, pairwiseBalances } from '../lib/balances';
import type { Settlement } from '../lib/types';
import { todayISO } from '../lib/format';

export interface SettleDefaults { from?: string; to?: string; amount?: number }

export default function SettleDialog({ open, onClose, defaults, existing }: { open: boolean; onClose: () => void; defaults?: SettleDefaults; existing?: Settlement }) {
  const { group, members, me, expenses, settlements, name, reload } = useGroup();
  const toast = useToast();
  const others = members.filter((m) => m.user_id !== me);
  const [from, setFrom] = useState(me);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setFrom(existing.payer_id); setTo(existing.receiver_id); setAmount(paiseToInput(existing.amount_paise));
      setNote(existing.note ?? ''); setDate(existing.settlement_date); setErr(null);
      requestId.current = crypto.randomUUID();
      return;
    }
    const f = defaults?.from ?? me;
    let t = defaults?.to ?? '';
    let defaultAmount = defaults?.amount;

    if (!defaults?.to && f === me) {
      const nets = computeNets(members.map((member) => member.user_id), expenses, settlements);
      const pw = pairwiseBalances(expenses, settlements);
      const debts = [...(pw.get(me)?.entries() ?? [])]
        .filter(([, debt]) => debt < 0)
        .map(([personId, debt]) => ({
          personId,
          amount: Math.min(-debt, maxSettlementAmount(nets, me, personId)),
        }))
        .filter((debt) => debt.amount > 0)
        .sort((a, b) => b.amount - a.amount);
      if (debts.length > 0) {
        t = debts[0].personId;
        defaultAmount = debts[0].amount;
      }
    }
    if (!t) t = (f === me ? others[0]?.user_id : me) ?? '';

    setFrom(f); setTo(t); setAmount(defaultAmount ? paiseToInput(defaultAmount) : ''); setNote(''); setDate(todayISO()); setErr(null);
    requestId.current = crypto.randomUUID();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const settlementsWithoutExisting = useMemo(
    () => settlements.filter((s) => existing ? s.id !== existing.id : true),
    [settlements, existing],
  );
  const nets = useMemo(
    () => computeNets(members.map((member) => member.user_id), expenses, settlementsWithoutExisting),
    [members, expenses, settlementsWithoutExisting],
  );

  const maxOwed = maxSettlementAmount(nets, from, to);

  const individualDebts = useMemo(() => {
    if (existing) return [];
    const pw = pairwiseBalances(expenses, settlementsWithoutExisting);
    const selectedFrom = from === me ? me : from;
    return [...(pw.get(selectedFrom)?.entries() ?? [])]
      .filter(([, debt]) => debt < 0)
      .map(([personId, debt]) => ({
        personId,
        amount: Math.min(-debt, maxSettlementAmount(nets, selectedFrom, personId)),
      }))
      .filter((debt) => debt.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [expenses, settlementsWithoutExisting, existing, from, me, nets]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const paise = parseINR(amount);
    if (!paise || paise <= 0) return setErr('Enter an amount above zero, like 500 or 250.50');
    if (from === to) return setErr('Choose two different people');
    if (!existing && paise > maxOwed) {
      return setErr(`The maximum repayment from ${name(from)} to ${name(to)} is ${formatINR(maxOwed)}.`);
    }
    setBusy(true); setErr(null);
    const { error } = existing
      ? await supabase.rpc('update_settlement', {
        p_settlement_id: existing.id, p_payer_id: from, p_receiver_id: to, p_amount_paise: paise,
        p_settlement_date: date, p_note: note || null, p_expected_updated_at: existing.updated_at,
      })
      : await supabase.rpc('record_settlement', {
        p_group_id: group.id, p_payer_id: from, p_receiver_id: to, p_amount_paise: paise,
        p_settlement_date: date, p_note: note || null, p_request_id: requestId.current,
      });
    setBusy(false);
    if (error) return setErr(error.message);
    toast(existing ? 'Repayment updated' : 'Repayment recorded');
    await reload();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit repayment' : 'Record a repayment'}>
      {others.length === 0 ? (
        <p className="text-ink-soft">Invite someone to the group first. Repayments are between two people.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Paid by">
              <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
                {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.user_id === me ? 'You' : m.name}</option>)}
              </select>
            </Field>
            <Field label="Paid to">
              <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
                {members.filter((m) => m.user_id !== from).map((m) => <option key={m.user_id} value={m.user_id}>{m.user_id === me ? 'You' : m.name}</option>)}
              </select>
            </Field>
          </div>
          {!existing && individualDebts.length > 0 && (
            <div className="rounded-2xl border border-line p-3">
              <p className="mb-2 text-sm font-semibold text-ink-soft">
                {from === me ? 'You owe' : `${name(from)} owes`}
              </p>
              <div className="space-y-2">
                {individualDebts.map((debt) => (
                  <button
                    key={debt.personId}
                    type="button"
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition ${
                      to === debt.personId ? 'bg-sage-100 text-sage-700' : 'bg-sage-50 hover:bg-sage-100'
                    }`}
                    onClick={() => { setTo(debt.personId); setAmount(paiseToInput(debt.amount)); setErr(null); }}
                  >
                    <span>{name(debt.personId)}</span>
                    <span className="num font-bold">{formatINR(debt.amount)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <Field label="Amount" hint={maxOwed > 0 ? `${name(from) === name(me) ? 'You owe' : `${name(from)} owes`} up to ${formatINR(maxOwed)} to ${name(to)}.` : undefined}>
            <input className="input num" inputMode="decimal" placeholder="₹0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><input type="date" className="input" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Note (optional)"><input className="input" maxLength={200} placeholder="UPI, cash…" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <p className="rounded-2xl bg-sage-50 px-4 py-3 text-sm text-ink-soft">This records that a payment happened. SplitLedger doesn’t check UPI or bank transfers, so it shows as “recorded”, not “verified”.</p>
          {err && <ErrorNote>{err}</ErrorNote>}
          <Btn type="submit" className="w-full" loading={busy}>{existing ? 'Save changes' : 'Record repayment'}</Btn>
        </form>
      )}
    </Modal>
  );
}
