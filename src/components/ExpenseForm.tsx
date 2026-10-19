import { FormEvent, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useGroup } from './GroupLayout';
import { Avatar, Btn, ErrorNote, Field, useToast } from './ui';
import { computeSplits, evenPercents, formatINR, paiseToInput, parseINR } from '../lib/money';
import { CATEGORIES, METHOD_LABEL, todayISO } from '../lib/format';
import type { Expense, SplitMethod } from '../lib/types';

const METHODS: SplitMethod[] = ['equal', 'percentage', 'manual', 'weighted'];
const SHORT: Record<SplitMethod, string> = { equal: 'Equal', percentage: 'Percent', manual: 'Amounts', weighted: 'Weights' };
const UNIT: Record<SplitMethod, string> = { equal: '', percentage: '%', manual: '₹', weighted: '×' };

function initialValues(e?: Expense): Record<string, string> {
  if (!e) return {};
  return Object.fromEntries(e.expense_splits.map((s) => [s.member_id,
    e.split_method === 'percentage' ? String(s.percentage ?? '') : e.split_method === 'weighted' ? String(s.weight ?? '') : e.split_method === 'manual' ? paiseToInput(s.share_amount_paise) : '']));
}

export default function ExpenseForm({ existing, onDone, onCancel }: { existing?: Expense; onDone: (id: string) => void; onCancel?: () => void }) {
  const { group, members, me, reload } = useGroup();
  const toast = useToast();
  const [amount, setAmount] = useState(existing ? paiseToInput(existing.total_amount_paise) : '');
  const [desc, setDesc] = useState(existing?.description ?? '');
  const [date, setDate] = useState(existing?.expense_date ?? todayISO());
  const [category, setCategory] = useState(existing?.category ?? '');
  const [payer, setPayer] = useState(existing?.payer_id ?? me);
  const [method, setMethod] = useState<SplitMethod>(existing?.split_method ?? 'equal');
  const [picked, setPicked] = useState<string[]>(existing ? existing.expense_splits.map((s) => s.member_id) : members.map((m) => m.user_id));
  const [vals, setVals] = useState<Record<string, string>>(initialValues(existing));
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID()); // makes double-submits harmless on the server
  const lock = useRef(false);

  const paise = parseINR(amount);
  const ordered = members.filter((m) => picked.includes(m.user_id)); // keep member order stable
  const preview = useMemo(() => (paise && paise > 0
    ? computeSplits(paise, method, ordered.map((m) => ({ memberId: m.user_id, value: vals[m.user_id] ?? '' })))
    : null), [paise, method, ordered, vals]);
  const shareOf = (id: string) => (preview?.ok ? preview.splits.find((s) => s.memberId === id)?.share : undefined);
  const showSplitErr = preview && !preview.ok && (attempted || (method !== 'equal' && Object.values(vals).some((v) => v !== '')));

  function fill(m: SplitMethod, ids: string[], p: number | null) {
    if (m === 'percentage') { const e = evenPercents(ids.length); return Object.fromEntries(ids.map((id, i) => [id, e[i]])); }
    if (m === 'weighted') return Object.fromEntries(ids.map((id) => [id, '1']));
    if (m === 'manual' && p) {
      const r = computeSplits(p, 'equal', ids.map((id) => ({ memberId: id, value: '' })));
      return r.ok ? Object.fromEntries(r.splits.map((s) => [s.memberId, paiseToInput(s.share)])) : {};
    }
    return {};
  }
  function pickMethod(m: SplitMethod) { setMethod(m); setVals(fill(m, ordered.map((x) => x.user_id), paise)); }
  function toggle(id: string) {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    if (method === 'weighted' && !picked.includes(id)) setVals((v) => ({ ...v, [id]: v[id] || '1' }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setAttempted(true); setErr(null);
    if (lock.current) return;
    if (!paise || paise <= 0) return setErr('Enter the total amount, like 450 or 1250.50');
    if (!desc.trim()) return setErr('Add a short description, like “Dinner”');
    if (!preview || !preview.ok) return setErr(preview?.error ?? 'Check the split');
    lock.current = true; setBusy(true);
    const inputs = ordered.map((m) => ({
      member_id: m.user_id,
      ...(method === 'equal' ? {} : { value: method === 'manual' ? parseINR(vals[m.user_id] ?? '') : Number(vals[m.user_id]) }),
    }));
    const common = {
      p_description: desc, p_total_paise: paise, p_payer_id: payer, p_expense_date: date,
      p_split_method: method, p_category: category || null, p_inputs: inputs,
    };
    const res = existing
      ? await supabase.rpc('update_expense', { p_expense_id: existing.id, ...common, p_expected_updated_at: existing.updated_at })
      : await supabase.rpc('create_expense', { p_group_id: group.id, ...common, p_request_id: requestId.current });
    setBusy(false); lock.current = false;
    if (res.error) return setErr(res.error.message);
    toast(existing ? 'Expense updated' : 'Expense saved');
    await reload();
    onDone(existing ? existing.id : (res.data as string));
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="card p-6">
        <label className="block">
          <span className="text-sm font-medium">How much?</span>
          <div className="mt-1 flex items-baseline gap-2 border-b-2 border-line pb-2 focus-within:border-sage-500">
            <span className="text-4xl font-extrabold text-ink-soft">₹</span>
            <input className="num w-full bg-transparent text-5xl font-extrabold tracking-tight outline-none placeholder:text-ink/15" inputMode="decimal" placeholder="0" autoFocus={!existing}
              value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Total amount in rupees" />
          </div>
        </label>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="What was it for?"><input className="input" maxLength={120} placeholder="Dinner, groceries, auto fare…" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
          <Field label="Date"><input type="date" className="input" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Paid by">
            <select className="input" value={payer} onChange={(e) => setPayer(e.target.value)}>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.user_id === me ? 'You' : m.name}</option>)}
            </select>
          </Field>
          <Field label="Category (optional)">
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">None</option>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>
      </div>

      <div className="card p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Split between</h2>
          <span className="text-sm text-ink-soft">{picked.length} of {members.length} selected</span>
        </div>
        <div className="mb-4 grid grid-cols-4 gap-1 rounded-full bg-black/5 p-1" role="tablist" aria-label="Split method">
          {METHODS.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={method === m} title={METHOD_LABEL[m]} onClick={() => pickMethod(m)}
              className={`rounded-full py-2 text-sm font-semibold transition ${method === m ? 'bg-paper shadow-sm' : 'text-ink-soft'}`}>{SHORT[m]}</button>
          ))}
        </div>
        <ul className="space-y-2">
          {members.map((m) => {
            const on = picked.includes(m.user_id);
            const share = shareOf(m.user_id);
            return (
              <li key={m.user_id} className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition ${on ? 'border-sage-500 bg-sage-50' : 'border-line bg-white'}`}>
                <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(m.user_id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <Avatar id={m.user_id} name={m.name} size={34} />
                  <span className={`truncate font-medium ${on ? '' : 'text-ink-soft'}`}>{m.user_id === me ? `${m.name} (you)` : m.name}</span>
                </button>
                {on && method !== 'equal' && (
                  <span className="flex items-center gap-1">
                    {method === 'manual' && <span className="text-ink-soft">₹</span>}
                    <input className="input num !w-20 !px-3 !py-2 text-right" inputMode="decimal" aria-label={`${m.name} ${METHOD_LABEL[method]}`}
                      value={vals[m.user_id] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [m.user_id]: e.target.value }))} />
                    {method !== 'manual' && <span className="w-3 text-ink-soft">{UNIT[method]}</span>}
                  </span>
                )}
                {on && <span className="num w-20 text-right text-sm font-semibold text-ink-soft">{share !== undefined ? formatINR(share) : '—'}</span>}
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex items-center justify-between gap-3">
          {method === 'equal' ? <span /> : (
            <button type="button" className="text-sm font-semibold text-sage-600 hover:underline"
              onClick={() => setVals(fill(method, ordered.map((x) => x.user_id), paise))}>{method === 'weighted' ? 'Reset weights to 1' : 'Fill evenly'}</button>
          )}
          {preview?.ok && <span className="text-sm text-ink-soft">Shares add up to {formatINR(paise!)}</span>}
        </div>
        {showSplitErr && preview && !preview.ok && <div className="mt-3"><ErrorNote>{preview.error}</ErrorNote></div>}
      </div>

      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="flex gap-3">
        {onCancel && <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>}
        <Btn type="submit" className="flex-1" loading={busy}>{existing ? 'Save changes' : 'Save expense'}</Btn>
      </div>
    </form>
  );
}
