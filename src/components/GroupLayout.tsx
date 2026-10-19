import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { BarChart3, ChevronLeft, HandCoins, Home, Plus, ReceiptText, Scale } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Balance, Expense, Group, MemberView, Settlement } from '../lib/types';
import { Empty, Spinner } from './ui';

export interface GroupCtx {
  group: Group; members: MemberView[]; me: string; isOwner: boolean;
  expenses: Expense[]; settlements: Settlement[]; balances: Balance[];
  /** Display name, or "You" for the signed-in user. */
  who: (id: string) => string;
  name: (id: string) => string;
  reload: () => Promise<void>;
}
export const useGroup = () => useOutletContext<GroupCtx>();

type Loaded = Omit<GroupCtx, 'who' | 'name' | 'me' | 'isOwner' | 'reload'>;

interface Tab { to: string; end?: boolean; label: string; icon: React.ElementType; desktopOnly?: boolean }
const TABS: Tab[] = [
  { to: '', end: true, label: 'Overview', icon: Home },
  { to: 'history', label: 'History', icon: ReceiptText },
  { to: 'balances', label: 'Balances', icon: Scale },
  { to: 'settlements', label: 'Repayments', icon: HandCoins, desktopOnly: true },
  { to: 'reports', label: 'Reports', icon: BarChart3 },
];

export default function GroupLayout() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const me = user!.id;
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!groupId) return;
    const [g, m, e, s, b] = await Promise.all([
      supabase.from('groups').select('*').eq('id', groupId).maybeSingle(),
      supabase.from('group_members').select('user_id, role, profiles(display_name)').eq('group_id', groupId),
      supabase.from('expenses').select('*, expense_splits(*)').eq('group_id', groupId).is('deleted_at', null)
        .order('expense_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('settlements').select('*').eq('group_id', groupId).order('settlement_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.rpc('group_balances', { p_group_id: groupId }),
    ]);
    const err = g.error ?? m.error ?? e.error ?? s.error ?? b.error;
    if (err) return setError(err.message);
    if (!g.data) return setError('not-found');
    setError(null);
    setData({
      group: g.data as Group,
      members: (m.data as any[]).map((r) => ({ user_id: r.user_id, role: r.role, name: r.profiles?.display_name ?? 'Member' }))
        .sort((x, y) => x.name.localeCompare(y.name)),
      expenses: e.data as Expense[], settlements: s.data as Settlement[], balances: b.data as Balance[],
    });
  }, [groupId]);

  useEffect(() => { setData(null); setError(null); load(); }, [load]);

  // Live updates: any change in this group refetches (debounced). RLS limits what events we receive.
  const timer = useRef<number>();
  useEffect(() => {
    if (!groupId) return;
    const kick = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(load, 250); };
    const f = { filter: `group_id=eq.${groupId}` };
    const ch = supabase.channel(`group-${groupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', ...f }, kick)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, kick)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', ...f }, kick)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', ...f }, kick)
      .subscribe();
    return () => { window.clearTimeout(timer.current); supabase.removeChannel(ch); };
  }, [groupId, load]);

  const ctx = useMemo<GroupCtx | null>(() => {
    if (!data) return null;
    const names = new Map(data.members.map((m) => [m.user_id, m.name]));
    const name = (id: string) => names.get(id) ?? 'Former member';
    return {
      ...data, me, name, who: (id) => (id === me ? 'You' : name(id)), reload: load,
      isOwner: data.members.some((m) => m.user_id === me && m.role === 'owner'),
    };
  }, [data, me, load]);

  if (error === 'not-found') {
    return <Empty title="We can’t find that group" action={<Link to="/dashboard" className="btn btn-soft">Back to your groups</Link>}>It may not exist, or you may not be a member.</Empty>;
  }
  if (error) return <Empty title="Couldn’t load this group" action={<button className="btn btn-soft" onClick={load}>Try again</button>}>{error}</Empty>;
  if (!ctx) return <Spinner label="Loading group" />;

  return (
    <div>
      <Link to="/dashboard" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"><ChevronLeft className="h-4 w-4" />All groups</Link>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-extrabold tracking-tight">{ctx.group.name}</h1>
          <p className="text-ink-soft">{ctx.members.length} {ctx.members.length === 1 ? 'person' : 'people'}</p>
        </div>
        <Link to="expenses/new" className="btn btn-primary hidden md:inline-flex"><Plus className="h-5 w-5" />Add expense</Link>
      </div>

      <nav aria-label="Group sections" className="mb-6 hidden gap-1 rounded-full bg-black/5 p-1 md:flex">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) =>
            `flex-1 rounded-full px-4 py-2 text-center text-sm font-semibold transition ${isActive ? 'bg-paper shadow-sm' : 'text-ink-soft hover:text-ink'}`}>{t.label}</NavLink>
        ))}
      </nav>

      <Outlet context={ctx} />

      <nav aria-label="Group sections" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md items-center justify-around px-2 py-2">
          {TABS.filter((t) => !t.desktopOnly).slice(0, 2).map((t) => <MobileTab key={t.to} to={t.to} end={t.end} label={t.label} icon={t.icon} />)}
          <Link to="expenses/new" aria-label="Add expense" className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-sage-600 text-white shadow-lg active:scale-95"><Plus className="h-7 w-7" /></Link>
          {TABS.filter((t) => !t.desktopOnly).slice(2).map((t) => <MobileTab key={t.to} to={t.to} end={t.end} label={t.label} icon={t.icon} />)}
        </div>
      </nav>
    </div>
  );
}

function MobileTab({ to, end, label, icon: Icon }: Tab) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `flex w-16 flex-col items-center gap-0.5 rounded-xl py-1 text-xs font-medium ${isActive ? 'text-sage-700' : 'text-ink-soft'}`}>
      <Icon className="h-5 w-5" />{label}
    </NavLink>
  );
}
