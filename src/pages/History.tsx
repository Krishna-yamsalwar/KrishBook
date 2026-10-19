import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownUp, Download, HandCoins, Search } from 'lucide-react';
import { useGroup } from '../components/GroupLayout';
import { Empty } from '../components/ui';
import { formatINR, rupeesStr } from '../lib/money';
import { METHOD_LABEL, fmtDate } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import type { Expense, Settlement } from '../lib/types';

type Row = { kind: 'e'; e: Expense; date: string; ts: string } | { kind: 's'; s: Settlement; date: string; ts: string };

export function expenseCSV(expenses: Expense[], who: (id: string) => string) {
  return [
    ['Date', 'Description', 'Category', 'Total (INR)', 'Paid by', 'Added by', 'Split method', 'Shares (INR)', 'Created at', 'Updated at'],
    ...expenses.map((e) => [e.expense_date, e.description, e.category ?? '', rupeesStr(e.total_amount_paise), who(e.payer_id), who(e.created_by), e.split_method,
      e.expense_splits.map((s) => `${who(s.member_id)}: ${rupeesStr(s.share_amount_paise)}`).join('; '), e.created_at, e.updated_at]),
  ];
}

export default function History() {
  const { group, expenses, settlements, members, me, who } = useGroup();
  const [q, setQ] = useState('');
  const [payer, setPayer] = useState('');
  const [type, setType] = useState<'all' | 'e' | 's'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [newestFirst, setNewestFirst] = useState(true);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all: Row[] = [
      ...(type === 's' ? [] : expenses.map((e): Row => ({ kind: 'e', e, date: e.expense_date, ts: e.created_at }))),
      ...(type === 'e' ? [] : settlements.filter((s) => s.status === 'recorded').map((s): Row => ({ kind: 's', s, date: s.settlement_date, ts: s.created_at }))),
    ];
    return all.filter((r) => {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      const p = r.kind === 'e' ? r.e.payer_id : r.s.payer_id;
      if (payer && p !== payer) return false;
      if (needle) {
        const text = r.kind === 'e' ? r.e.description : `${r.s.note ?? ''} ${who(r.s.payer_id)} ${who(r.s.receiver_id)} repayment`;
        if (!text.toLowerCase().includes(needle)) return false;
      }
      return true;
    }).sort((a, b) => { const c = a.date.localeCompare(b.date) || a.ts.localeCompare(b.ts); return newestFirst ? -c : c; });
  }, [expenses, settlements, q, payer, type, from, to, newestFirst, who]);

  const shownExpenses = rows.flatMap((r) => (r.kind === 'e' ? [r.e] : []));
  const shownTotal = shownExpenses.reduce((a, e) => a + e.total_amount_paise, 0);
  const filtered = Boolean(q || payer || from || to || type !== 'all');

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input className="input !pl-11" placeholder="Search by description" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search by description" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <select className="input" value={payer} onChange={(e) => setPayer(e.target.value)} aria-label="Filter by payer">
            <option value="">Anyone paid</option>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.user_id === me ? 'You' : m.name}</option>)}
          </select>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Filter by type">
            <option value="all">Expenses and repayments</option><option value="e">Expenses only</option><option value="s">Repayments only</option>
          </select>
          <input type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-ink-soft">{rows.length} {rows.length === 1 ? 'entry' : 'entries'} · {formatINR(shownTotal)} spent</p>
          <div className="flex gap-1">
            {filtered && <button className="btn-ghost rounded-full px-3 py-1.5 font-medium" onClick={() => { setQ(''); setPayer(''); setType('all'); setFrom(''); setTo(''); }}>Clear filters</button>}
            <button className="btn-ghost inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium" onClick={() => setNewestFirst((v) => !v)}><ArrowDownUp className="h-4 w-4" />{newestFirst ? 'Newest first' : 'Oldest first'}</button>
            <button className="btn-ghost inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium" disabled={shownExpenses.length === 0}
              onClick={() => downloadCSV(`${group.name}-expenses.csv`, expenseCSV(shownExpenses, who))}><Download className="h-4 w-4" />CSV</button>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        filtered ? <Empty title="Nothing matches those filters">Try a different search or clear the filters.</Empty>
          : <Empty title="No expenses yet" action={<Link to="../expenses/new" relative="path" className="btn btn-primary">Add the first expense</Link>}>Whoever pays first can add it. Everyone in the group sees it right away.</Empty>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {rows.map((r) => r.kind === 'e' ? (
            <li key={r.e.id}>
              <Link to={`../expenses/${r.e.id}`} relative="path" className="flex items-center gap-4 px-5 py-4 transition hover:bg-sage-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.e.description}</p>
                  <p className="truncate text-sm text-ink-soft">{who(r.e.payer_id)} paid · {fmtDate(r.e.expense_date)} · {METHOD_LABEL[r.e.split_method]}{r.e.category ? ` · ${r.e.category}` : ''}</p>
                </div>
                <div className="text-right">
                  <p className="num font-bold">{formatINR(r.e.total_amount_paise)}</p>
                  {(() => { const mine = r.e.expense_splits.find((s) => s.member_id === me); return <p className="num text-xs text-ink-soft">{mine ? `your share ${formatINR(mine.share_amount_paise)}` : 'not in this split'}</p>; })()}
                </div>
              </Link>
            </li>
          ) : (
            <li key={r.s.id} className="flex items-center gap-4 bg-sage-50/60 px-5 py-4">
              <HandCoins className="h-5 w-5 text-sage-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-sage-700">{who(r.s.payer_id)} repaid {who(r.s.receiver_id)}</p>
                <p className="truncate text-sm text-ink-soft">{fmtDate(r.s.settlement_date)}{r.s.note ? ` · ${r.s.note}` : ''}</p>
              </div>
              <p className="num font-bold text-sage-700">{formatINR(r.s.amount_paise)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
