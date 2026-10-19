const pad = (n: number) => String(n).padStart(2, '0');

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** 'YYYY-MM-DD' → local Date without timezone drift. */
export const parseDay = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
export const fmtDate = (iso: string) => parseDay(iso.slice(0, 10)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDateTime = (ts: string) => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
export const monthLabel = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
export const monthKey = (iso: string) => iso.slice(0, 7);
export const CATEGORIES = ['Food', 'Groceries', 'Transport', 'Rent', 'Bills', 'Fun', 'Travel', 'Other'];
export const METHOD_LABEL = { equal: 'Equal', percentage: 'Percentage', manual: 'Exact amounts', weighted: 'Weighted' } as const;
