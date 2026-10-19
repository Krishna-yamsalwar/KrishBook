import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useGroup } from '../components/GroupLayout';
import BalanceBars from '../components/BalanceBars';
import SettleDialog, { SettleDefaults } from '../components/SettleDialog';
import { Btn, Empty } from '../components/ui';
import { formatINR } from '../lib/money';
import { suggestTransfers } from '../lib/balances';

export default function Balances() {
  const { balances, who, name, me, expenses } = useGroup();
  const [dialog, setDialog] = useState<SettleDefaults | null>(null);
  const transfers = useMemo(() => suggestTransfers(Object.fromEntries(balances.map((b) => [b.user_id, b.net_paise]))), [balances]);
  const sorted = [...balances].sort((a, b) => b.net_paise - a.net_paise);

  if (expenses.length === 0 && balances.every((b) => b.net_paise === 0)) {
    return <Empty title="Nothing to balance yet">Once expenses are added, you’ll see who owes whom here.</Empty>;
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <h2 className="mb-5 text-lg font-bold">Where everyone stands</h2>
        <BalanceBars balances={balances} who={who} name={name} />
        <p className="mt-5 text-sm text-ink-soft">Paid minus share, adjusted for repayments. Right of the line means “gets money back”, left means “owes”.</p>
      </section>

      <section className="card p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Suggested repayments</h2>
          <Link to="../settlements" relative="path" className="text-sm font-semibold text-sage-600 hover:underline">Repayment history</Link>
        </div>
        {transfers.length === 0 ? <p className="text-ink-soft">Everyone’s settled. Nothing to pay.</p> : (
          <ul className="divide-y divide-line">
            {transfers.map((t) => {
              const mine = t.from === me || t.to === me;
              return (
                <li key={t.from + t.to} className="flex items-center gap-3 py-3">
                  <p className="flex flex-1 flex-wrap items-center gap-1.5 font-medium">{who(t.from)} <ArrowRight className="h-4 w-4 text-ink-soft" /> {who(t.to)}</p>
                  <span className="num font-bold">{formatINR(t.amount)}</span>
                  {mine && <Btn variant="soft" className="!px-4 !py-2 text-sm" onClick={() => setDialog({ from: t.from, to: t.to, amount: t.amount })}>Record</Btn>}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 text-sm text-ink-soft">These keep the number of payments low. Settle however you like. Recording a repayment only notes that it happened.</p>
      </section>

      <section className="card overflow-x-auto p-2">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="text-ink-soft"><tr><th className="px-4 py-3 font-medium">Member</th><th className="px-4 py-3 text-right font-medium">Paid</th><th className="px-4 py-3 text-right font-medium">Share</th><th className="px-4 py-3 text-right font-medium">Repaid</th><th className="px-4 py-3 text-right font-medium">Net</th></tr></thead>
          <tbody className="divide-y divide-line">
            {sorted.map((b) => (
              <tr key={b.user_id}>
                <td className="px-4 py-3 font-medium">{who(b.user_id)}</td>
                <td className="num px-4 py-3 text-right">{formatINR(b.paid_paise)}</td>
                <td className="num px-4 py-3 text-right">{formatINR(b.share_paise)}</td>
                <td className="num px-4 py-3 text-right">{formatINR(b.settled_out_paise - b.settled_in_paise, { signed: true })}</td>
                <td className={`num px-4 py-3 text-right font-bold ${b.net_paise > 0 ? 'text-sage-600' : b.net_paise < 0 ? 'text-owe' : ''}`}>{formatINR(b.net_paise, { signed: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <SettleDialog open={dialog !== null} onClose={() => setDialog(null)} defaults={dialog ?? undefined} />
    </div>
  );
}
