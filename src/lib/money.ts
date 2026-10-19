import type { SplitMethod } from './types';

/** Integer paise → "12.50" (no symbol). Safe for CSV. */
export function rupeesStr(paise: number): string {
  const a = Math.abs(Math.round(paise));
  const s = `${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
  return paise < 0 ? `-${s}` : s;
}

/** Integer paise → "₹1,250" / "₹1,250.50" with Indian digit grouping. */
export function formatINR(paise: number, opts: { signed?: boolean } = {}): string {
  const a = Math.abs(paise);
  const whole = a % 100 === 0;
  const s = new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR',
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
  }).format(a / 100);
  if (opts.signed && paise !== 0) return (paise > 0 ? '+' : '−') + s;
  return paise < 0 ? '−' + s : s;
}

export const paiseToInput = (p: number) => (p % 100 === 0 ? String(p / 100) : rupeesStr(p));

/** "1,234.5" → 123450. Returns null for anything that isn't a plain amount with ≤2 decimals. */
export function parseINR(input: string): number | null {
  const t = input.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  const paise = Number(w) * 100 + Number(f.padEnd(2, '0'));
  return Number.isSafeInteger(paise) && paise <= 1e12 ? paise : null;
}

/** Decimal with ≤2 places → integer ×100 (used for percentages and weights). */
export function parseScaled(input: string): bigint | null {
  const t = input.replace(/[,\s%]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  return BigInt(w) * 100n + BigInt(f.padEnd(2, '0'));
}

export interface SplitInput { memberId: string; value: string }
export interface SplitResult { memberId: string; share: number; percentage?: number; weight?: number }
export type SplitOutcome = { ok: true; splits: SplitResult[] } | { ok: false; error: string };

/**
 * Split `total` paise between people. Mirrors public._compute_splits in the database
 * (largest remainder; ties go to the lowest member id), so the preview always matches
 * what the server saves. The server recomputes everything and never trusts this result.
 */
export function computeSplits(total: number, method: SplitMethod, inputs: SplitInput[]): SplitOutcome {
  if (!Number.isInteger(total) || total <= 0) return { ok: false, error: 'Enter an amount above zero' };
  if (inputs.length === 0) return { ok: false, error: 'Pick at least one person to split with' };

  if (method === 'manual') {
    const shares: number[] = [];
    for (const i of inputs) {
      const p = parseINR(i.value);
      if (p === null || p <= 0) return { ok: false, error: 'Enter an amount above zero for everyone selected' };
      shares.push(p);
    }
    const sum = shares.reduce((a, b) => a + b, 0);
    if (sum !== total) {
      const diff = total - sum;
      return { ok: false, error: `Shares add up to ${formatINR(sum)} — ${diff > 0 ? `${formatINR(diff)} still to assign` : `${formatINR(-diff)} too much`}` };
    }
    return { ok: true, splits: inputs.map((i, k) => ({ memberId: i.memberId, share: shares[k] })) };
  }

  let ws: bigint[];
  if (method === 'equal') {
    ws = inputs.map(() => 1n);
  } else {
    const parsed = inputs.map((i) => parseScaled(i.value));
    if (parsed.some((w) => w === null || w <= 0n)) {
      return { ok: false, error: method === 'percentage'
        ? 'Every selected person needs a percentage above zero'
        : 'Every selected person needs a weight above zero. Untick anyone who didn’t take part.' };
    }
    ws = parsed as bigint[];
    if (method === 'percentage') {
      const sum = ws.reduce((a, b) => a + b, 0n);
      if (sum !== 10000n) return { ok: false, error: `Percentages add up to ${Number(sum) / 100}% — they need to total exactly 100%` };
    }
  }

  const T = BigInt(total);
  const S = ws.reduce((a, b) => a + b, 0n);
  const rows = inputs.map((i, k) => {
    const num = T * ws[k];
    return { id: i.memberId, fl: num / S, frac: num % S };
  });
  const left = T - rows.reduce((a, r) => a + r.fl, 0n);
  const order = [...rows].sort((x, y) => (x.frac === y.frac ? (x.id < y.id ? -1 : 1) : x.frac > y.frac ? -1 : 1));
  const extra = new Set(order.slice(0, Number(left)).map((r) => r.id));

  return {
    ok: true,
    splits: rows.map((r, k) => ({
      memberId: r.id,
      share: Number(r.fl) + (extra.has(r.id) ? 1 : 0),
      ...(method === 'percentage' ? { percentage: Number(ws[k]) / 100 } : {}),
      ...(method === 'weighted' ? { weight: Number(ws[k]) / 100 } : {}),
    })),
  };
}

/** Percentages that sum to exactly 100.00, e.g. 3 people → 33.34 / 33.33 / 33.33. */
export function evenPercents(n: number): string[] {
  if (n <= 0) return [];
  const base = Math.floor(10000 / n);
  const extra = 10000 - base * n;
  return Array.from({ length: n }, (_, i) => ((base + (i < extra ? 1 : 0)) / 100).toString());
}
