import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';

interface AuthCtx {
  session: Session | null; user: User | null; profile: Profile | null; loading: boolean;
  refreshProfile: () => Promise<void>; signOut: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;
  const refreshProfile = useCallback(async () => {
    if (!uid) return setProfile(null);
    const { data } = await supabase.from('profiles').select('id, display_name').eq('id', uid).maybeSingle();
    setProfile(data as Profile | null);
  }, [uid]);
  useEffect(() => { refreshProfile(); }, [refreshProfile]);

  const signOut = useCallback(async () => { await supabase.auth.signOut(); setProfile(null); }, []);

  return <Ctx.Provider value={{ session, user: session?.user ?? null, profile, loading, refreshProfile, signOut }}>{children}</Ctx.Provider>;
}
