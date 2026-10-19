import { useState } from 'react';
import { Download, HandCoins, Pencil } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useGroup } from '../components/GroupLayout';
import SettleDialog from '../components/SettleDialog';
import { Btn, ConfirmDialog, Empty, ErrorNote, useToast } from '../components/ui';
import { formatINR, rupeesStr } from '../lib/money';
import { fmtDate, fmtDateTime } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import type { Settlement } from '../lib/types';

export default function Settlements() {
  const { group, settlements, me, isOwner, who, reload } = useGroup();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Settlement | null>(null);
  const [editing, setEditing] = useState<Settlement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function voidIt() {
    if (!target) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc('void_settlement', { p_settlement_id: target.id });
    setBusy(false); setTarget(null);
    if (error) return setErr(error.message);
    toast('Repayment voided'); await reload();
  }

  const exportCsv = () => downloadCSV(`${group.name}-repayments.csv`, [
    ['Date', 'Paid by', 'Paid to', 'Amount (INR)', 'Note', 'Status', 'Recorded by', 'Recorded at'],
    ...settlements.map((s) => [s.settlement_date, who(s.payer_id), who(s.receiver_id), rupeesStr(s.amount_paise), s.note ?? '', s.status, who(s.created_by), s.created_at]),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-sm text-ink-soft">Repayments are not expenses. They only move balances. Each one is “recorded” by a member, not verified against a bank or UPI.</p>
        <div className="flex gap-2">
          <Btn variant="ghost" onClick={exportCsv} disabled={settlements.length === 0}><Download className="h-4 w-4" />CSV</Btn>
          <Btn onClick={() => setOpen(true)}><HandCoins className="h-5 w-5" />Record repayment</Btn>
        </div>
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {settlements.length === 0 ? <Empty title="No repayments yet">When someone pays someone back, record it here and the balances update.</Empty> : (
        <ul className="card divide-y divide-line overflow-hidden">
          {settlements.map((s) => {
            const voided = s.status === 'voided';
            const canVoid = !voided && (s.created_by === me || s.payer_id === me || s.receiver_id === me || isOwner);
            return (
              <li key={s.id} className="flex items-center gap-4 px-5 py-4">
                <div className={`min-w-0 flex-1 ${voided ? 'opacity-50' : ''}`}>
                  <p className={`font-semibold ${voided ? 'line-through' : ''}`}>{who(s.payer_id)} repaid {who(s.receiver_id)}</p>
                  <p className="text-sm text-ink-soft">{fmtDate(s.settlement_date)}{s.note ? ` · ${s.note}` : ''} · recorded by {who(s.created_by)} {fmtDateTime(s.created_at)}{s.updated_at > s.created_at && !voided ? ` · edited ${fmtDateTime(s.updated_at)}` : ''}</p>
                </div>
                <div className="text-right">
                  <p className={`num font-bold ${voided ? 'text-ink-soft line-through' : ''}`}>{formatINR(s.amount_paise)}</p>
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${voided ? 'bg-black/5 text-ink-soft' : 'bg-sage-100 text-sage-700'}`}>{voided ? 'Voided' : 'Recorded'}</span>
                </div>
                {canVoid && <Btn variant="ghost" className="!px-3 !py-2 text-sm" aria-label="Edit repayment" onClick={() => setEditing(s)}><Pencil className="h-4 w-4" />Edit</Btn>}
                {canVoid && <Btn variant="ghost" className="!px-3 !py-2 text-sm" onClick={() => setTarget(s)}>Void</Btn>}
              </li>
            );
          })}
        </ul>
      )}
      <SettleDialog open={open} onClose={() => setOpen(false)} />
      <SettleDialog open={!!editing} existing={editing ?? undefined} onClose={() => setEditing(null)} />
      <ConfirmDialog open={!!target} busy={busy} title="Void this repayment?" confirmLabel="Void repayment" onClose={() => setTarget(null)} onConfirm={voidIt}
        body={target && <>{who(target.payer_id)} → {who(target.receiver_id)} for {formatINR(target.amount_paise)} will stop counting toward balances. It stays in the list as voided.</>} />
    </div>
  );
}
