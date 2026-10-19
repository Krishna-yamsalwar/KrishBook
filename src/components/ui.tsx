import { ButtonHTMLAttributes, ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';

const TINTS = ['#E1EFE8', '#DCE8F2', '#F3EBDD', '#EDE6F3', '#F7E7E9', '#E6EFD9'];
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export function Avatar({ id, name, size = 36 }: { id: string; name: string; size?: number }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-ink/80"
      style={{ width: size, height: size, background: TINTS[hash(id) % TINTS.length], fontSize: size * 0.4 }}>
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div role="status" className="flex items-center justify-center gap-2 py-16 text-ink-soft"><Loader2 className="h-5 w-5 animate-spin" />{label}…</div>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card px-6 py-12 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-ink-soft">{children}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div role="alert" className="flex items-start gap-2 rounded-2xl bg-owe-soft px-4 py-3 text-sm text-owe-deep"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{children}</span></div>;
}

const VARIANT = { primary: 'btn-primary', soft: 'btn-soft', ghost: 'btn-ghost', danger: 'btn-danger' } as const;
export function Btn({ variant = 'primary', loading = false, className = '', children, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANT; loading?: boolean }) {
  return (
    <button type="button" {...rest} disabled={disabled || loading} className={`btn ${VARIANT[variant]} ${className}`}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}{children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-sm text-ink-soft">{hint}</span>}
    </label>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-paper p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-xl md:max-w-md md:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="btn-ghost rounded-full p-2"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel, busy, onConfirm, onClose }:
  { open: boolean; title: string; body: ReactNode; confirmLabel: string; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-ink-soft">{body}</p>
      <div className="mt-6 flex gap-3">
        <Btn variant="ghost" className="flex-1" onClick={onClose}>Keep it</Btn>
        <Btn variant="danger" className="flex-1" loading={busy} onClick={onConfirm}>{confirmLabel}</Btn>
      </div>
    </Modal>
  );
}

type Toast = { id: number; msg: string; kind: 'ok' | 'err' } | null;
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<Toast>(null);
  const show = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now();
    setT({ id, msg, kind });
    setTimeout(() => setT((c) => (c && c.id === id ? null : c)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div role="status" className="fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 md:bottom-8">
          <div className={`flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium shadow-lg ${t.kind === 'ok' ? 'bg-ink text-white' : 'bg-owe-deep text-white'}`}>
            {t.kind === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}{t.msg}
          </div>
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export const Logo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
    <rect width="32" height="32" rx="10" fill="#E1EFE8" />
    {/* book spine */}
    <rect x="10" y="7" width="3" height="18" rx="1.5" fill="#4C8B7A" />
    {/* book cover */}
    <rect x="13" y="7" width="10" height="18" rx="1" fill="#3C7262" />
    {/* page lines */}
    <line x1="15" y1="12" x2="21" y2="12" stroke="#E1EFE8" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="15" y1="15" x2="21" y2="15" stroke="#E1EFE8" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="15" y1="18" x2="19" y2="18" stroke="#E1EFE8" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
