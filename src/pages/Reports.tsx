import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download } from 'lucide-react';
import { useGroup } from '../components/GroupLayout';
import { Btn, Empty } from '../components/ui';
import { formatINR } from '../lib/money';
import { monthKey, monthLabel, todayISO } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import { expenseCSV } from './History';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function preset(p: string): [string, string] {
  const n = new Date();
  if (p === 'this') return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), todayISO()];
  if (p === 'last') return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))];
  if (p === '3m') return [iso(new Date(n.getFullYear(), n.getMonth() - 2, 1)), todayISO()];
  return ['', ''];
}

const tip = (v: number) => formatINR(Math.round(v * 100));

export default function Reports() {
  const { group, expenses, members, who, name } = useGroup();
  const [range, setRange] = useState('this');
  const [cf, setCf] = useState('');
  const [ct, setCt] = useState('');
  const [from, to] = range === 'custom' ? [cf, ct] : range === 'all' ? ['', ''] : preset(range);

  const inRange = useMemo(() => expenses.filter((e) => (!from || e.expense_date >= from) && (!to || e.expense_date <= to)), [expenses, from, to]);
  const total = inRange.reduce((a, e) => a + e.total_amount_paise, 0);

  const byMember = useMemo(() => members.map((m) => ({
    name: name(m.user_id),
    Paid: inRange.filter((e) => e.payer_id === m.user_id).reduce((a, e) => a + e.total_amount_paise, 0) / 100,
    Share: inRange.flatMap((e) => e.expense_splits).filter((s) => s.member_id === m.user_id).reduce((a, s) => a + s.share_amount_paise, 0) / 100,
  })), [inRange, members, name]);

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of inRange) m.set(e.category ?? 'Uncategorised', (m.get(e.category ?? 'Uncategorised') ?? 0) + e.total_amount_paise);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([category, p]) => ({ category, Spent: p / 100 }));
  }, [inRange]);

  const byMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of inRange) m.set(monthKey(e.expense_date), (m.get(monthKey(e.expense_date)) ?? 0) + e.total_amount_paise);
    return [...m.entries()].sort().map(([k, p]) => ({ month: monthLabel(k), Spent: p / 100 }));
  }, [inRange]);

  const axis = { fontSize: 12, fill: '#5C6E68' };
  const label = range === 'custom' ? 'custom range' : range === 'this' ? 'this month' : range === 'last' ? 'last month' : range === '3m' ? 'last 3 months' : 'all time';

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <select className="input !w-auto" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Report period">
          <option value="this">This month</option><option value="last">Last month</option><option value="3m">Last 3 months</option><option value="all">All time</option><option value="custom">Custom range</option>
        </select>
        {range === 'custom' && <>
          <input type="date" className="input !w-auto" value={cf} max={ct || undefined} onChange={(e) => setCf(e.target.value)} aria-label="From date" />
          <input type="date" className="input !w-auto" value={ct} min={cf || undefined} onChange={(e) => setCt(e.target.value)} aria-label="To date" />
        </>}
        <div className="flex-1" />
        <Btn variant="soft" disabled={inRange.length === 0} onClick={() => downloadCSV(`${group.name}-${label.replace(/ /g, '-')}.csv`, expenseCSV(inRange, who))}><Download className="h-4 w-4" />Export CSV</Btn>
      </div>

      {inRange.length === 0 ? <Empty title={`No expenses for ${label}`}>Pick another period, or add an expense.</Empty> : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="card p-5"><p className="text-sm text-ink-soft">Total spent</p><p className="num mt-1 text-3xl font-extrabold">{formatINR(total)}</p></div>
            <div className="card p-5"><p className="text-sm text-ink-soft">Expenses</p><p className="num mt-1 text-3xl font-extrabold">{inRange.length}</p></div>
          </div>
          <section className="card p-6">
            <h2 className="mb-1 text-lg font-bold">Who paid and who owes what</h2>
            <p className="mb-4 text-sm text-ink-soft">Paid is money out of pocket. Share is each person’s part of the costs.</p>
            <div className="h-64"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMember} margin={{ left: -10 }}><CartesianGrid vertical={false} stroke="#DCE6E0" /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={axis} /><YAxis tickLine={false} axisLine={false} tick={axis} />
                <Tooltip cursor={{ fill: 'rgba(0,0,0,.04)' }} formatter={tip} /><Legend />
                <Bar dataKey="Paid" fill="#4C8B7A" radius={[6, 6, 0, 0]} /><Bar dataKey="Share" fill="#9CC3B4" radius={[6, 6, 0, 0]} /></BarChart>
            </ResponsiveContainer></div>
          </section>
          <div className="grid gap-6 md:grid-cols-2">
            <section className="card p-6">
              <h2 className="mb-4 text-lg font-bold">By category</h2>
              <ul className="space-y-3">
                {byCategory.map((c) => (
                  <li key={c.category}>
                    <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{c.category}</span><span className="num text-ink-soft">{tip(c.Spent)}</span></div>
                    <div className="h-2 rounded-full bg-black/5"><div className="h-full rounded-full bg-sage-500" style={{ width: `${(c.Spent * 100 / total) * 100}%` }} /></div>
                  </li>
                ))}
              </ul>
            </section>
            <section className="card p-6">
              <h2 className="mb-4 text-lg font-bold">By month</h2>
              <div className="h-48"><ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMonth} margin={{ left: -10 }}><XAxis dataKey="month" tickLine={false} axisLine={false} tick={axis} /><YAxis tickLine={false} axisLine={false} tick={axis} />
                  <Tooltip cursor={{ fill: 'rgba(0,0,0,.04)' }} formatter={tip} /><Bar dataKey="Spent" fill="#6E93B5" radius={[6, 6, 0, 0]} /></BarChart>
              </ResponsiveContainer></div>
            </section>
          </div>
          <p className="text-center text-sm text-ink-soft">Check: contributions add up to {formatINR(byMember.reduce((a, m) => a + Math.round(m.Paid * 100), 0))}, which matches the total of {formatINR(total)}.</p>
        </>
      )}
    </div>
  );
}
