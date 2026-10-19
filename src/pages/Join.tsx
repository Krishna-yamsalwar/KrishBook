import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Empty, Spinner, useToast } from '../components/ui';

export default function Join() {
  const { token } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !token) return;
    started.current = true;
    supabase.rpc('join_group', { p_token: token }).then(({ data, error }) => {
      if (error) return setErr(error.message);
      toast('You’re in');
      nav(`/groups/${data}`, { replace: true });
    });
  }, [token, nav, toast]);

  if (err) return <Empty title="We couldn’t use that invite" action={<Link to="/dashboard" className="btn btn-soft">Back to your groups</Link>}>{err}</Empty>;
  return <Spinner label="Joining group" />;
}
