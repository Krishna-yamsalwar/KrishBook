import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Btn, ErrorNote, Field, Logo } from '../components/ui';

export default function Login() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? '/dashboard';
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!loading && user) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null); setNotice(null);
    if (mode === 'up' && !name.trim()) return setErr('Add the name your group will see');
    if (password.length < 8) return setErr('Use a password with at least 8 characters');
    setBusy(true);
    if (mode === 'in') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setBusy(false);
      if (error) return setErr(error.message);
      nav(from, { replace: true });
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(), password,
        options: { data: { display_name: name.trim() }, emailRedirectTo: `${window.location.origin}/dashboard` },
      });
      setBusy(false);
      if (error) return setErr(error.message);
      if (!data.session) setNotice('Check your email to confirm your account, then sign in.');
      else nav(from, { replace: true });
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-2.5"><Logo size={36} /><span className="text-2xl font-extrabold tracking-tight">SplitLedger</span></div>
        <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight">Split costs, keep the peace.</h1>
        <p className="mt-3 text-lg text-ink-soft">Everyone adds their own expenses. SplitLedger keeps a shared tally of who owes whom.</p>

        <form onSubmit={submit} className="card mt-8 space-y-4 p-6">
          <div className="grid grid-cols-2 gap-1 rounded-full bg-black/5 p-1" role="tablist">
            {(['in', 'up'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErr(null); }}
                className={`rounded-full py-2 text-sm font-semibold transition ${mode === m ? 'bg-paper shadow-sm' : 'text-ink-soft'}`}>
                {m === 'in' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>
          {mode === 'up' && <Field label="Your name"><input className="input" autoComplete="name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field>}
          <Field label="Email"><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password" hint={mode === 'up' ? 'At least 8 characters.' : undefined}>
            <input className="input" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {err && <ErrorNote>{err}</ErrorNote>}
          {notice && <p className="rounded-2xl bg-sage-100 px-4 py-3 text-sm text-sage-700">{notice}</p>}
          <Btn type="submit" className="w-full" loading={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</Btn>
        </form>
      </div>
    </div>
  );
}
