import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useGroup } from '../components/GroupLayout';
import ExpenseForm from '../components/ExpenseForm';
import { Avatar, Btn, ConfirmDialog, Empty, ErrorNote, useToast } from '../components/ui';
import { formatINR } from '../lib/money';
import { METHOD_LABEL, fmtDate, fmtDateTime } from '../lib/format';
import type { AuditLog } from '../lib/types';

const FIELDS: [string, string][] = [['description', 'Description'], ['total_amount_paise', 'Amount'], ['payer_id', 'Paid by'], ['expense_date', 'Date'], ['split_method', 'Split method'], ['category', 'Category']];

export default function ExpenseDetail() {
  const { expenseId } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { group, expenses, me, isOwner, who, name, reload } = useGroup();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<AuditLog[]>([]);

  const e = expenses.find((x) => x.id === expenseId);
  useEffect(() => {
    if (!expenseId) return;
    supabase.from('audit_logs').select('*').eq('entity_id', expenseId).order('created_at', { ascending: false })
      .then(({ data }) => setLog((data ?? []) as AuditLog[]));
  }, [expenseId, e?.updated_at, !!e]);

  if (!e) return <Empty title="That expense isn’t here" action={<Link to={`/groups/${group.id}/history`} className="btn btn-soft">Back to history</Link>}>It may have been deleted.</Empty>;

  const canEdit = e.created_by === me || isOwner;
  const fmtVal = (k: string, v: unknown) => v == null || v === '' ? 'none' : k === 'total_amount_paise' ? formatINR(Number(v)) : k === 'payer_id' ? who(String(v)) : k === 'split_method' ? METHOD_LABEL[v as keyof typeof METHOD_LABEL] ?? String(v) : k === 'expense_date' ? fmtDate(String(v)) : String(v);

  async function remove() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc('delete_expense', { p_expense_id: e!.id });
    setBusy(false);
    if (error) { setConfirm(false); return setErr(error.message); }
    toast('Expense deleted');
    await reload();
    nav(`/groups/${group.id}/history`, { replace: true });
  }

  if (editing) {
    return (
      <div className="mx-auto max-w-xl">
        <h2 className="mb-4 text-2xl font-extrabold tracking-tight">Edit expense</h2>
        <ExpenseForm existing={e} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <section className="card p-6">
        <p className="text-sm text-ink-soft">{e.category ?? 'Expense'}</p>
        <h2 className="mt-1 text-2xl font-extrabold tracking-tight">{e.description}</h2>
        <p className="num mt-2 text-5xl font-extrabold tracking-tight">{formatINR(e.total_amount_paise)}</p>
        <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
          <div><dt className="text-ink-soft">Paid by</dt><dd className="font-semibold">{who(e.payer_id)}</dd></div>
          <div><dt className="text-ink-soft">Added by</dt><dd className="font-semibold">{who(e.created_by)}</dd></div>
          <div><dt className="text-ink-soft">Date</dt><dd className="font-semibold">{fmtDate(e.expense_date)}</dd></div>
          <div><dt className="text-ink-soft">Split</dt><dd className="font-semibold">{METHOD_LABEL[e.split_method]}</dd></div>
          <div><dt className="text-ink-soft">Created</dt><dd>{fmtDateTime(e.created_at)}</dd></div>
          <div><dt className="text-ink-soft">Last changed</dt><dd>{fmtDateTime(e.updated_at)}</dd></div>
        </dl>
      </section>

      <section className="card p-6">
        <h3 className="mb-3 text-lg font-bold">Shares</h3>
        <ul className="divide-y divide-line">
          {[...e.expense_splits].sort((a, b) => name(a.member_id).localeCompare(name(b.member_id))).map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <Avatar id={s.member_id} name={name(s.member_id)} size={32} />
              <span className="flex-1 font-medium">{who(s.member_id)}</span>
              {e.split_method === 'percentage' && s.percentage != null && <span className="text-sm text-ink-soft">{Number(s.percentage)}%</span>}
              {e.split_method === 'weighted' && s.weight != null && <span className="text-sm text-ink-soft">weight {Number(s.weight)}</span>}
              <span className="num font-semibold">{formatINR(s.share_amount_paise)}</span>
            </li>
          ))}
        </ul>
      </section>

      {err && <ErrorNote>{err}</ErrorNote>}
      {canEdit ? (
        <div className="flex gap-3">
          <Btn variant="soft" className="flex-1" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit</Btn>
          <Btn variant="danger" className="flex-1" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />Delete</Btn>
        </div>
      ) : <p className="text-sm text-ink-soft">Only {who(e.created_by)} or the group owner can change this expense.</p>}

      <section className="card p-6">
        <h3 className="mb-3 text-lg font-bold">Change history</h3>
        <ul className="space-y-4">
          {log.map((l) => {
            const changes = l.action === 'update' ? FIELDS.filter(([k]) => l.previous_values?.[k] !== l.new_values?.[k]) : [];
            const splitsChanged = l.action === 'update' && JSON.stringify(l.previous_values?.splits) !== JSON.stringify(l.new_values?.splits);
            return (
              <li key={l.id} className="text-sm">
                <p><span className="font-semibold">{who(l.actor_id)}</span> {l.action === 'create' ? 'added this expense' : l.action === 'update' ? 'edited this expense' : 'deleted this expense'} <span className="text-ink-soft">· {fmtDateTime(l.created_at)}</span></p>
                {changes.map(([k, label]) => <p key={k} className="text-ink-soft">{label}: {fmtVal(k, l.previous_values?.[k])} → {fmtVal(k, l.new_values?.[k])}</p>)}
                {splitsChanged && <p className="text-ink-soft">Shares were recalculated</p>}
              </li>
            );
          })}
        </ul>
      </section>

      <ConfirmDialog open={confirm} busy={busy} title="Delete this expense?" confirmLabel="Delete expense" onClose={() => setConfirm(false)} onConfirm={remove}
        body={<>“{e.description}” for {formatINR(e.total_amount_paise)} will be removed and everyone’s balance will update. The change stays in the history log.</>} />
    </div>
  );
}
