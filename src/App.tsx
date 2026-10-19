import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/ui';
import { configured } from './lib/supabase';
import AppShell from './components/AppShell';
import GroupLayout from './components/GroupLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NewGroup from './pages/NewGroup';
import Join from './pages/Join';
import Settings from './pages/Settings';
import GroupHome from './pages/GroupHome';
import ExpenseNew from './pages/ExpenseNew';
import ExpenseDetail from './pages/ExpenseDetail';
import History from './pages/History';
import Balances from './pages/Balances';
import Settlements from './pages/Settlements';
import Reports from './pages/Reports';

export default function App() {
  if (!configured) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h1 className="text-2xl font-bold">Almost there</h1>
        <p className="mt-2 text-ink-soft">Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to a <code>.env</code> file (see <code>.env.example</code>), then restart the dev server.</p>
      </div>
    );
  }
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<AppShell />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/groups/new" element={<NewGroup />} />
              <Route path="/join/:token" element={<Join />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/groups/:groupId" element={<GroupLayout />}>
                <Route index element={<GroupHome />} />
                <Route path="expenses/new" element={<ExpenseNew />} />
                <Route path="expenses/:expenseId" element={<ExpenseDetail />} />
                <Route path="history" element={<History />} />
                <Route path="balances" element={<Balances />} />
                <Route path="settlements" element={<Settlements />} />
                <Route path="reports" element={<Reports />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
