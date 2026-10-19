import { FormEvent, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useGroup } from './GroupLayout';
import { Avatar, Btn, ErrorNote, Field, useToast } from './ui';
import { computeSplits, evenPercents, formatINR, paiseToInput, parseINR } from '../lib/money';
import { CATEGORIES, METHOD_LABEL, todayISO } from '../lib/format';
import type { Expense, SplitMethod } from '../lib/types';

const METHODS: SplitMethod[] = ['equal', 'percentage', 'manual', 'weighted'];
const SHORT: Record<SplitMethod, string> = { equal: 'Equal', percentage: 'Percent', manual: 'Amounts', weighted: 'Weights' };

function initialValues(e?: Expense): Record<string, string> {
  if (!e) return {};
  return Object.fromEntries(e.expense_splits.map((s) => [s.member_id,
    e.split_method === 'percentage' ? String(s.percentage ?? '') :
    e.split_method === 'weighted' ? String(s.weight ?? '') :
    e.split_method === 'manual' ? paiseToInput(s.share_amount_paise) : '']));
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
  const [picked, setPicked] = useState<string[]>(
    existing ? existing.expense_splits.map((s) => s.member_id) : members.map((m) => m.user_id)
  );
  const [vals, setVals] = useState<Record<string, string>>(initialValues(existing));
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const lock = useRef(false);

  const paise = parseINR(amount);
  const ordered = members.filter((m) => picked.includes(m.user_id));

  const preview = useMemo(() => {
    if (!paise || paise <= 0) return null;
    return computeSplits(paise, method, ordered.map((m) => ({ memberId: m.user_id, value: vals[m.user_id] ?? '' })));
  }, [paise, method, ordered, vals]);

  const shareOf = (id: string) => preview?.ok ? preview.splits.find((s) => s.memberId === id)?.share : undefined;
  const showSplitErr = preview && !preview.ok && (attempted || (method !== 'equal' && Object.values(vals).some((v) => v !== '')));

  // running total for manual mode
  const manualSum = method === 'manual'
    ? ordered.reduce((acc, m) => acc + (parseINR(vals[m.user_id] ?? '') ?? 0), 0)
    : null;

  function fill(m: SplitMethod, ids: string[], p: number | null): Record<string, string> {
    if (m === 'percentage') {
      const e = evenPercents(ids.length);
      return Object.fromEntries(ids.map((id, i) => [id, e[i]]));
    }
    if (m === 'weighted') return Object.fromEntries(ids.map((id) => [id, '1']));
    if (m === 'manual' && p) {
      const r = computeSplits(p, 'equal', ids.map((id) => ({ memberId: id, value: '' })));
      return r.ok ? Object.fromEntries(r.splits.map((s) => [s.memberId, paiseToInput(s.share)])) : {};
    }
    return {};
  }

  function pickMethod(m: SplitMethod) {
    setMethod(m);
    setVals(fill(m, ordered.map((x) => x.user_id), paise));
  }

  function toggle(id: string) {
    const isOn = picked.includes(id);
    const next = isOn ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    if (!isOn) {
      // adding: give sensible default
      if (method === 'weighted') setVals((v) => ({ ...v, [id]: '1' }));
      if (method === 'percentage') setVals((v) => ({ ...v, [id]: '0' }));
      if (method === 'manual') setVals((v) => ({ ...v, [id]: '0' }));
    }
    // for equal: no vals needed, preview auto-recalculates
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setAttempted(true); setErr(null);
    if (lock.current) return;
    if (!paise || paise <= 0) return setErr('Enter the total amount, like 450 or 1250.50');
    if (!desc.trim()) return setErr('Add a short description, like "Dinner"');
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
      {/* Amount */}
      <div className="card p-6">
        <label className="block">
          <span className="text-sm font-medium">How much?</span>
          <div className="mt-1 flex items-baseline gap-2 border-b-2 border-line pb-2 focus-within:border-sage-500">
            <span className="text-4xl font-extrabold text-ink-soft">₹</span>
            <input className="num w-full bg-transparent text-5xl font-extrabold tracking-tight outline-none placeholder:text-ink/15"
              inputMode="decimal" placeholder="0" autoFocus={!existing}
              value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Total amount in rupees" />
          </div>
        </label>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="What was it for?">
            <input className="input" maxLength={120} placeholder="Dinner, groceries, auto fare…" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
          <Field label="Date">
            <input type="date" className="input" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </Field>
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

      {/* Split */}
      <div className="card p-6">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Split between</h2>
          <span className="text-sm text-ink-soft">{picked.length} of {members.length}</span>
        </div>

        {/* Method tabs */}
        <div className="mb-5 grid grid-cols-4 gap-1 rounded-full bg-black/5 p-1" role="tablist" aria-label="Split method">
          {METHODS.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={method === m} title={METHOD_LABEL[m]} onClick={() => pickMethod(m)}
              className={`rounded-full py-2 text-sm font-semibold transition ${method === m ? 'bg-paper shadow-sm' : 'text-ink-soft'}`}>
              {SHORT[m]}
            </button>
          ))}
        </div>

        {/* Member rows */}
        <ul className="space-y-2">
          {members.map((m) => {
            const on = picked.includes(m.user_id);
            const share = shareOf(m.user_id);
            const isMe = m.user_id === me;

            return (
              <li key={m.user_id}
                className={`rounded-2xl border transition ${on ? 'border-sage-500 bg-sage-50' : 'border-line bg-white opacity-60'}`}>
                {/* Top row: checkbox + name + share badge */}
                <div className="flex items-center gap-3 px-3 py-2.5">
                  {/* Checkbox */}
                  <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(m.user_id)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition
                      ${on ? 'border-sage-500 bg-sage-500' : 'border-line bg-white'}`}>
                    {on && (
                      <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>

                  <Avatar id={m.user_id} name={m.name} size={32} />

                  <span className={`flex-1 truncate font-medium ${on ? '' : 'text-ink-soft'}`}>
                    {isMe ? `${m.name} (you)` : m.name}
                  </span>

                  {/* Live share amount */}
                  {on && (
                    <span className={`num text-sm font-bold tabular-nums ${share !== undefined && share > 0 ? 'text-sage-700' : 'text-ink-soft'}`}>
                      {share !== undefined ? formatINR(share) : '—'}
                    </span>
                  )}
                </div>

                {/* Input row for non-equal methods */}
                {on && method !== 'equal' && (
                  <div className="flex items-center gap-2 border-t border-line/40 px-3 py-2">
                    <span className="text-xs text-ink-soft w-16">
                      {method === 'percentage' ? 'Percent' : method === 'manual' ? 'Amount' : 'Weight'}
                    </span>
                    <div className="flex flex-1 items-center gap-1">
                      {method === 'manual' && <span className="text-ink-soft text-sm">₹</span>}
                      <input
                        className="input num flex-1 !py-1.5 text-right"
                        inputMode="decimal"
                        aria-label={`${m.name} ${METHOD_LABEL[method]}`}
                        value={vals[m.user_id] ?? ''}
                        onChange={(e) => setVals((v) => ({ ...v, [m.user_id]: e.target.value }))}
                      />
                      {method === 'percentage' && <span className="text-ink-soft text-sm">%</span>}
                      {method === 'weighted' && <span className="text-ink-soft text-sm">×</span>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* Footer: totals / reset */}
        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          {method === 'equal' ? (
            paise && paise > 0 && picked.length > 0 ? (
              <span className="text-ink-soft">
                ₹{(paise / picked.length / 100).toFixed(2)} each
                {paise % picked.length !== 0 ? ' (adjusted for paise)' : ''}
              </span>
            ) : <span />
          ) : (
            <button type="button" className="font-semibold text-sage-600 hover:underline"
              onClick={() => setVals(fill(method, ordered.map((x) => x.user_id), paise))}>
              {method === 'weighted' ? 'Reset to equal weights' : method === 'percentage' ? 'Distribute evenly' : 'Fill evenly'}
            </button>
          )}

          {/* Running total for manual */}
          {method === 'manual' && paise && paise > 0 && (
            <span className={`num font-semibold tabular-nums ${manualSum === paise ? 'text-sage-600' : 'text-owe-deep'}`}>
              {formatINR(manualSum ?? 0)} / {formatINR(paise)}
            </span>
          )}

          {/* Percent total */}
          {method === 'percentage' && (
            <span className={`num font-semibold tabular-nums ${
              ordered.reduce((a, m) => a + (parseFloat(vals[m.user_id] ?? '0') || 0), 0) === 100
                ? 'text-sage-600' : 'text-owe-deep'
            }`}>
              {ordered.reduce((a, m) => a + (parseFloat(vals[m.user_id] ?? '0') || 0), 0).toFixed(2)}%
            </span>
          )}

          {preview?.ok && method !== 'manual' && method !== 'percentage' && (
            <span className="text-ink-soft">= {formatINR(paise!)}</span>
          )}
        </div>

        {showSplitErr && preview && !preview.ok && (
          <div className="mt-3"><ErrorNote>{preview.error}</ErrorNote></div>
        )}
      </div>

      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="flex gap-3">
        {onCancel && <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>}
        <Btn type="submit" className="flex-1" loading={busy}>{existing ? 'Save changes' : 'Save expense'}</Btn>
      </div>
    </form>
  );
}
