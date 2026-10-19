import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { ArrowRight, Check, Copy, HandCoins, Plus, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useGroup } from '../components/GroupLayout';
import BalanceBars from '../components/BalanceBars';
import SettleDialog from '../components/SettleDialog';
import { Btn, ErrorNote, Modal, useToast } from '../components/ui';
import { formatINR } from '../lib/money';
import { suggestTransfers } from '../lib/balances';
import { fmtDate, monthKey, monthLabel } from '../lib/format';

export default function GroupHome() {
  const { group, members, me, expenses, settlements, balances, who, name } = useGroup();
  const toast = useToast();
  const [settleOpen, setSettleOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [shortCode, setShortCode] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState<'link' | 'code' | null>(null);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const myNet = balances.find((b) => b.user_id === me)?.net_paise ?? 0;
  const total = expenses.reduce((a, e) => a + e.total_amount_paise, 0);
  const myPaid = expenses.filter((e) => e.payer_id === me).reduce((a, e) => a + e.total_amount_paise, 0);
  const myShare = expenses.flatMap((e) => e.expense_splits).filter((s) => s.member_id === me).reduce((a, s) => a + s.share_amount_paise, 0);
  const myTransfers = useMemo(() => suggestTransfers(Object.fromEntries(balances.map((b) => [b.user_id, b.net_paise]))).filter((t) => t.from === me || t.to === me), [balances, me]);

  const months = useMemo(() => {
    const now = new Date();
    const keys = Array.from({ length: 6 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
    const sums = new Map(keys.map((k) => [k, 0]));
    for (const e of expenses) { const k = monthKey(e.expense_date); if (sums.has(k)) sums.set(k, sums.get(k)! + e.total_amount_paise); }
    return keys.map((k) => ({ month: monthLabel(k), rupees: (sums.get(k) ?? 0) / 100 }));
  }, [expenses]);

  const activity = useMemo(() => [
    ...expenses.map((e) => ({ id: e.id, ts: e.created_at, kind: 'e' as const, e })),
    ...settlements.filter((s) => s.status === 'recorded').map((s) => ({ id: s.id, ts: s.created_at, kind: 's' as const, s })),
  ].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 6), [expenses, settlements]);

  function openInvite() {
    setInviteLink(null); setShortCode(null); setInviteErr(null); setInviteOpen(true);
  }
  async function makeLink() {
    setInviteErr(null); setInviteBusy('link');
    const { data, error } = await supabase.rpc('create_open_invitation', { p_group_id: group.id });
    setInviteBusy(null);
    if (error) return setInviteErr(error.message);
    setInviteLink(`${window.location.origin}/join/${data}`);
  }
  async function makeCode() {
    setInviteErr(null); setInviteBusy('code');
    const { data, error } = await supabase.rpc('create_short_code', { p_group_id: group.id });
    setInviteBusy(null);
    if (error) return setInviteErr(error.message);
    setShortCode(data as string);
  }
  async function copyLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopiedLink(true); toast('Link copied'); setTimeout(() => setCopiedLink(false), 2000);
  }
  async function copyCode() {
    if (!shortCode) return;
    await navigator.clipboard.writeText(shortCode);
    setCopiedCode(true); toast('Code copied'); setTimeout(() => setCopiedCode(false), 2000);
  }

  const hero = myNet > 0
    ? { bg: 'bg-sage-100', fg: 'text-sage-700', big: `You're owed ${formatINR(myNet)}` }
    : myNet < 0
    ? { bg: 'bg-owe-soft', fg: 'text-owe-deep', big: `You owe ${formatINR(-myNet)}` }
    : { bg: 'bg-sage-100', fg: 'text-sage-700', big: expenses.length ? "You're all settled" : 'Nothing spent yet' };

  return (
    <div className="space-y-6">
      <section className={`rounded-3xl ${hero.bg} p-6 md:p-8`}>
        <p className={`num text-4xl font-extrabold tracking-tight md:text-5xl ${hero.fg}`}>{hero.big}</p>
        <div className={`mt-2 space-y-0.5 ${hero.fg}`}>
          {myTransfers.length === 0 && <p className="opacity-80">{expenses.length ? 'Nothing to chase right now.' : 'Add the first expense and the tally starts itself.'}</p>}
          {myTransfers.map((t) => (
            <p key={t.from + t.to} className="flex items-center gap-1.5 opacity-90">
              {t.from === me ? <>You pay {name(t.to)}</> : <>{name(t.from)} pays you</>} <ArrowRight className="h-3.5 w-3.5" /> <span className="num font-semibold">{formatINR(t.amount)}</span>
            </p>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="expenses/new" className="btn btn-primary"><Plus className="h-5 w-5" />Add expense</Link>
          <Btn variant="soft" className="!bg-white/70 hover:!bg-white" onClick={() => setSettleOpen(true)}><HandCoins className="h-5 w-5" />Settle up</Btn>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-5">
        <section className="card p-6 md:col-span-3">
          <h2 className="mb-5 text-lg font-bold">Who's ahead</h2>
          <BalanceBars balances={balances} who={who} name={name} />
          <Link to="balances" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-sage-600 hover:underline">Details and repayments <ArrowRight className="h-4 w-4" /></Link>
        </section>

        <section className="grid grid-cols-3 gap-3 md:col-span-2 md:grid-cols-1">
          {[['Group spent', total], ['You paid', myPaid], ['Your share', myShare]].map(([label, v]) => (
            <div key={label as string} className="card p-4 md:flex md:items-baseline md:justify-between md:px-6 md:py-5">
              <p className="text-sm text-ink-soft">{label}</p>
              <p className="num mt-1 text-xl font-extrabold md:mt-0 md:text-2xl">{formatINR(v as number)}</p>
            </div>
          ))}
        </section>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card p-6">
          <h2 className="mb-4 text-lg font-bold">Recent activity</h2>
          {activity.length === 0 ? <p className="text-ink-soft">Nothing yet. Expenses and repayments will show up here.</p> : (
            <ul className="divide-y divide-line">
              {activity.map((a) => a.kind === 'e' ? (
                <li key={a.id}>
                  <Link to={`expenses/${a.e.id}`} className="flex items-center justify-between gap-3 py-3 hover:opacity-80">
                    <div className="min-w-0"><p className="truncate font-medium">{a.e.description}</p><p className="text-sm text-ink-soft">{who(a.e.payer_id)} paid · {fmtDate(a.e.expense_date)}</p></div>
                    <span className="num font-semibold">{formatINR(a.e.total_amount_paise)}</span>
                  </Link>
                </li>
              ) : (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0"><p className="truncate font-medium text-sage-700">{who(a.s.payer_id)} repaid {who(a.s.receiver_id)}</p><p className="text-sm text-ink-soft">{fmtDate(a.s.settlement_date)}</p></div>
                  <span className="num font-semibold text-sage-700">{formatINR(a.s.amount_paise)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-6">
          <h2 className="mb-4 text-lg font-bold">Spending by month</h2>
          <div className="h-44" aria-label="Monthly spending chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#5C6E68' }} />
                <Tooltip cursor={{ fill: 'rgba(0,0,0,.04)' }} formatter={(v: number) => formatINR(Math.round(v * 100))} labelStyle={{ fontWeight: 600 }} />
                <Bar dataKey="rupees" name="Spent" fill="#4C8B7A" radius={[8, 8, 8, 8]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Invite section — visible to all members */}
      <section className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="font-semibold">{members.length === 1 ? "You're the only one here" : 'Add someone'}</p>
          <p className="text-sm text-ink-soft">Share a link or a 6-digit code — anyone with it can join.</p>
        </div>
        <Btn variant="soft" onClick={openInvite}><UserPlus className="h-5 w-5" />Invite people</Btn>
      </section>

      {/* Invite modal */}
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite to group">
        <div className="space-y-4">

          {/* Link */}
          <div className="rounded-2xl border border-line p-4">
            <p className="font-semibold">Share a link</p>
            <p className="mt-0.5 text-sm text-ink-soft">Anyone with this link can join. Valid for 7 days.</p>
            {inviteLink ? (
              <>
                <input readOnly className="input num mt-3 text-sm" value={inviteLink}
                  onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
                <Btn className="mt-2 w-full" onClick={copyLink}>
                  {copiedLink ? <><Check className="h-4 w-4" />Copied</> : <><Copy className="h-4 w-4" />Copy link</>}
                </Btn>
              </>
            ) : (
              <Btn variant="soft" className="mt-3 w-full" loading={inviteBusy === 'link'} onClick={makeLink}>
                Generate link
              </Btn>
            )}
          </div>

          {/* Code */}
          <div className="rounded-2xl border border-line p-4">
            <p className="font-semibold">Share a 6-digit code</p>
            <p className="mt-0.5 text-sm text-ink-soft">Read it out or type it in chat. Valid for 7 days.</p>
            {shortCode ? (
              <>
                <div className="mt-3 flex items-center justify-center gap-2">
                  {shortCode.split('').map((d, i) => (
                    <span key={i} className="num flex h-12 w-10 items-center justify-center rounded-xl border border-sage-200 bg-sage-50 text-2xl font-extrabold text-sage-700">
                      {d}
                    </span>
                  ))}
                </div>
                <Btn className="mt-3 w-full" onClick={copyCode}>
                  {copiedCode ? <><Check className="h-4 w-4" />Copied</> : <><Copy className="h-4 w-4" />Copy code</>}
                </Btn>
              </>
            ) : (
              <Btn variant="soft" className="mt-3 w-full" loading={inviteBusy === 'code'} onClick={makeCode}>
                Generate code
              </Btn>
            )}
          </div>

          {inviteErr && <ErrorNote>{inviteErr}</ErrorNote>}
        </div>
      </Modal>

      <SettleDialog open={settleOpen} onClose={() => setSettleOpen(false)} />
    </div>
  );
}
