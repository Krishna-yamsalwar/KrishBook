import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Btn, ErrorNote, Field, useToast } from '../components/ui';

export default function NewGroup() {
  const nav = useNavigate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setErr('Give the group a name, like “Roommates” or “Goa trip”');
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc('create_group', { p_name: name });
    setBusy(false);
    if (error) return setErr(error.message);
    toast('Group created. Invite your people next.');
    nav(`/groups/${data}`, { replace: true });
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-extrabold tracking-tight">New group</h1>
      <p className="mt-1 text-ink-soft">A private space where everyone adds their own expenses.</p>
      <form onSubmit={submit} className="card mt-6 space-y-4 p-6">
        <Field label="Group name"><input className="input" autoFocus maxLength={80} placeholder="College friends" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {err && <ErrorNote>{err}</ErrorNote>}
        <Btn type="submit" className="w-full" loading={busy}>Create group</Btn>
      </form>
    </div>
  );
}
