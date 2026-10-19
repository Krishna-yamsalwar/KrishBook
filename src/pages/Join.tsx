import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Btn, Empty, ErrorNote, Spinner } from '../components/ui';

export default function Join() {
  const { token } = useParams();
  const nav = useNavigate();
  const started = useRef(false);

  // token-based auto-join
  const [tokenErr, setTokenErr] = useState<string | null>(null);
  useEffect(() => {
    if (started.current || !token) return;
    started.current = true;
    supabase.rpc('join_group', { p_token: token }).then(({ data, error }) => {
      if (error) return setTokenErr(error.message);
      nav(`/groups/${data}`, { replace: true });
    });
  }, [token, nav]);

  // manual code entry
  const [code, setCode] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeErr, setCodeErr] = useState<string | null>(null);

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.replace(/\s/g, '');
    if (trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) {
      return setCodeErr('Enter the 6-digit number code from your invite.');
    }
    setCodeErr(null); setCodeBusy(true);
    const { data, error } = await supabase.rpc('join_group_by_code', { p_code: trimmed });
    setCodeBusy(false);
    if (error) return setCodeErr(error.message);
    nav(`/groups/${data}`, { replace: true });
  }

  // if a token was in the URL, show its result
  if (token) {
    if (tokenErr) return (
      <Empty title="We couldn't use that invite link" action={<Link to="/dashboard" className="btn btn-soft">Back to your groups</Link>}>
        {tokenErr}
      </Empty>
    );
    return <Spinner label="Joining group" />;
  }

  // no token — show the code entry form
  return (
    <div className="mx-auto max-w-sm space-y-6 pt-10">
      <div className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">Join a group</h1>
        <p className="mt-2 text-ink-soft">Enter the 6-digit code from your invite.</p>
      </div>

      <form onSubmit={submitCode} className="card space-y-4 p-6">
        <div>
          <label className="mb-2 block text-sm font-medium">6-digit code</label>
          <input
            className="input num text-center text-3xl font-extrabold tracking-[0.4em]"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setCodeErr(null); }}
            autoFocus
            aria-label="6-digit invite code"
          />
        </div>
        {codeErr && <ErrorNote>{codeErr}</ErrorNote>}
        <Btn type="submit" className="w-full" loading={codeBusy}>Join group</Btn>
      </form>

      <p className="text-center text-sm text-ink-soft">
        Have a link instead?{' '}
        <Link to="/dashboard" className="font-semibold text-sage-600 hover:underline">Go to dashboard</Link>
      </p>
    </div>
  );
}
