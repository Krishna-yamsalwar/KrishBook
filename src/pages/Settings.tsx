import { FormEvent, useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Btn, ErrorNote, Field, useToast } from '../components/ui';

export default function Settings() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (profile) setName(profile.display_name); }, [profile]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setErr('Your name can’t be empty');
    setBusy(true); setErr(null);
    const { error } = await supabase.from('profiles').update({ display_name: name.trim() }).eq('id', user!.id);
    setBusy(false);
    if (error) return setErr(error.message);
    await refreshProfile();
    toast('Name updated');
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-3xl font-extrabold tracking-tight">Settings</h1>
      <form onSubmit={save} className="card space-y-4 p-6">
        <Field label="Display name" hint="This is how your group sees you."><input className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email"><input className="input bg-black/[.03]" value={user?.email ?? ''} readOnly /></Field>
        {err && <ErrorNote>{err}</ErrorNote>}
        <Btn type="submit" loading={busy}>Save changes</Btn>
      </form>
      <Btn variant="ghost" className="w-full" onClick={signOut}><LogOut className="h-4 w-4" />Sign out</Btn>
    </div>
  );
}
