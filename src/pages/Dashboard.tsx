import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, KeyRound, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Balance } from '../lib/types';
import { formatINR } from '../lib/money';
import { Avatar, Btn, Empty, ErrorNote, Spinner } from '../components/ui';

interface Row { id: string; name: string; net: number; people: number }

export default function Dashboard() {
  const { user, profile } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    let off = false;
    (async () => {
      const { data, error } = await supabase.from('group_members').select('groups(id, name)').eq('user_id', user!.id);
      if (error) return setErr(error.message);
      const list = await Promise.all((data as any[]).map(async (r): Promise<Row> => {
        const { data: b } = await supabase.rpc('group_balances', { p_group_id: r.groups.id });
        const bal = (b ?? []) as Balance[];
        return { id: r.groups.id, name: r.groups.name, net: bal.find((x) => x.user_id === user!.id)?.net_paise ?? 0, people: bal.length };
      }));
      if (!off) setRows(list.sort((a, b) => a.name.localeCompare(b.name)));
    })();
    return () => { off = true; };
  }, [user]);

  const owed = (rows ?? []).reduce((a, r) => a + Math.max(r.net, 0), 0);
  const owe = (rows ?? []).reduce((a, r) => a + Math.max(-r.net, 0), 0);

  function join(e: FormEvent) {
    e.preventDefault();
    const token = code.trim().split('/').filter(Boolean).pop();
    if (token) nav(`/join/${token}`);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Hey {profile?.display_name?.split(' ')[0] ?? 'there'}</h1>
          <p className="text-ink-soft">Here’s where everything stands.</p>
        </div>
        <Link to="/groups/new" className="btn btn-primary"><Plus className="h-5 w-5" />New group</Link>
      </div>

      {err && <ErrorNote>{err}</ErrorNote>}
      {!rows && !err && <Spinner label="Loading your groups" />}

      {rows && rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-3xl bg-sage-100 p-5"><p className="text-sm text-sage-700">You’re owed</p><p className="num mt-1 text-3xl font-extrabold text-sage-700">{formatINR(owed)}</p></div>
            <div className="rounded-3xl bg-owe-soft p-5"><p className="text-sm text-owe-deep">You owe</p><p className="num mt-1 text-3xl font-extrabold text-owe-deep">{formatINR(owe)}</p></div>
          </div>
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id}>
                <Link to={`/groups/${r.id}`} className="card flex items-center gap-4 p-4 transition hover:border-sage-200 hover:bg-sage-50">
                  <Avatar id={r.id} name={r.name} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.name}</p>
                    <p className="text-sm text-ink-soft">{r.people} {r.people === 1 ? 'person' : 'people'}</p>
                  </div>
                  <span className={`num text-sm font-semibold ${r.net > 0 ? 'text-sage-600' : r.net < 0 ? 'text-owe' : 'text-ink-soft'}`}>
                    {r.net > 0 ? `You’re owed ${formatINR(r.net)}` : r.net < 0 ? `You owe ${formatINR(-r.net)}` : 'All settled'}
                  </span>
                  <ChevronRight className="h-4 w-4 text-ink-soft" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {rows && rows.length === 0 && (
        <Empty title="No groups yet" action={<Link to="/groups/new" className="btn btn-primary">Create your first group</Link>}>
          Make a group for your roommates, trip or couple, then invite the others with a link.
        </Empty>
      )}

      <form onSubmit={join} className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3 sm:flex-1"><KeyRound className="h-5 w-5 shrink-0 text-ink-soft" /><p className="font-medium">Got an invite?</p></div>
        <input className="input sm:max-w-xs" placeholder="Paste invite link or code" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Invite link or code" />
        <Btn type="submit" variant="soft" disabled={!code.trim()}>Join group</Btn>
      </form>
    </div>
  );
}
