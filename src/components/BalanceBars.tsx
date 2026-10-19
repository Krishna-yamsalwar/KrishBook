import { useEffect, useState } from 'react';
import type { Balance } from '../lib/types';
import { formatINR } from '../lib/money';
import { Avatar } from './ui';

/** Calm diverging bars: money you're owed grows to the right (sage), money owed grows to the left (rose). */
export default function BalanceBars({ balances, who, name }: { balances: Balance[]; who: (id: string) => string; name: (id: string) => string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 80); return () => clearTimeout(t); }, []);
  const max = Math.max(1, ...balances.map((b) => Math.abs(b.net_paise)));
  const rows = [...balances].sort((a, b) => b.net_paise - a.net_paise);
  return (
    <ul className="space-y-4">
      {rows.map((b) => {
        const pct = ready ? (Math.abs(b.net_paise) / max) * 50 : 0;
        const pos = b.net_paise > 0, neg = b.net_paise < 0;
        return (
          <li key={b.user_id} className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
            <Avatar id={b.user_id} name={name(b.user_id)} size={32} />
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-medium">{who(b.user_id)}</span>
              <span className={`num text-sm font-semibold ${pos ? 'text-sage-600' : neg ? 'text-owe' : 'text-ink-soft'}`}>
                {pos ? `gets back ${formatINR(b.net_paise)}` : neg ? `owes ${formatINR(-b.net_paise)}` : 'settled'}
              </span>
            </div>
            <span />
            <div className="relative h-2.5 rounded-full bg-black/5" role="img" aria-label={`${who(b.user_id)} ${pos ? 'is owed' : neg ? 'owes' : 'is settled'} ${formatINR(Math.abs(b.net_paise))}`}>
              <span className="absolute left-1/2 top-[-3px] h-4 w-px bg-ink/20" />
              <span className={`absolute top-0 h-full rounded-full transition-[width] duration-700 ease-out ${pos ? 'left-1/2 bg-sage-500' : 'right-1/2 bg-owe'}`} style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
