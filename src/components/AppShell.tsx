import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Avatar, Logo, Spinner } from './ui';

export default function AppShell() {
  const { user, profile, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  const name = profile?.display_name ?? '';
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-mist/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/dashboard" className="flex items-center gap-2 text-lg font-bold tracking-tight"><Logo />KrishBook</Link>
          <Link to="/settings" aria-label="Settings" className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 hover:bg-black/5">
            <Avatar id={user.id} name={name || '?'} size={30} />
            <span className="hidden text-sm font-medium sm:inline">{name}</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 pb-28 md:pb-10"><Outlet /></main>
    </div>
  );
}
