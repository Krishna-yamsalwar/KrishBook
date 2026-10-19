import { describe, it, expect } from 'vitest';
import { computeSplits, parseINR, formatINR, evenPercents, rupeesStr } from './money';
import { computeNets, suggestTransfers } from './balances';
import { toCSV } from './csv';

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ memberId: String.fromCharCode(97 + i), value: '' }));
const shares = (r: ReturnType<typeof computeSplits>) => (r.ok ? r.splits.map((s) => s.share) : r.error);

describe('equal split', () => {
  it('two people: ₹200 → ₹100 each', () => expect(shares(computeSplits(20000, 'equal', ids(2)))).toEqual([10000, 10000]));
  it('three people: fractional paise go to lowest ids, total preserved', () => {
    expect(shares(computeSplits(10001, 'equal', ids(3)))).toEqual([3334, 3334, 3333]);
  });
  it('five people: ₹100 → ₹20 each; ₹100.03 keeps the total', () => {
    expect(shares(computeSplits(10000, 'equal', ids(5)))).toEqual([2000, 2000, 2000, 2000, 2000]);
    const r = computeSplits(10003, 'equal', ids(5));
    expect((shares(r) as number[]).reduce((a, b) => a + b, 0)).toBe(10003);
  });
  it('is deterministic regardless of input order', () => {
    const fwd = computeSplits(10001, 'equal', ids(3));
    const rev = computeSplits(10001, 'equal', ids(3).reverse());
    const m = (r: typeof fwd) => (r.ok ? Object.fromEntries(r.splits.map((s) => [s.memberId, s.share])) : {});
    expect(m(rev)).toEqual(m(fwd));
  });
  it('1 paisa between 3 people never creates or loses money', () => expect(shares(computeSplits(1, 'equal', ids(3)))).toEqual([1, 0, 0]));
});

describe('percentage split', () => {
  const p = (...v: string[]) => ids(v.length).map((x, i) => ({ ...x, value: v[i] }));
  it('30/70 of ₹200 → ₹60 / ₹140', () => expect(shares(computeSplits(20000, 'percentage', p('30', '70')))).toEqual([6000, 14000]));
  it('rejects totals other than 100', () => expect(computeSplits(20000, 'percentage', p('30', '60')).ok).toBe(false));
  it('33.34 / 33.33 / 33.33 keeps the total', () => {
    const r = shares(computeSplits(10001, 'percentage', p('33.34', '33.33', '33.33'))) as number[];
    expect(r.reduce((a, b) => a + b, 0)).toBe(10001);
  });
  it('evenPercents always sums to 100', () => {
    for (const n of [1, 2, 3, 6, 7]) expect(Math.round(evenPercents(n).reduce((a, b) => a + Number(b), 0) * 100)).toBe(10000);
  });
});

describe('manual split', () => {
  const m = (...v: string[]) => ids(v.length).map((x, i) => ({ ...x, value: v[i] }));
  it('accepts shares that match', () => expect(shares(computeSplits(20000, 'manual', m('80', '70', '50')))).toEqual([8000, 7000, 5000]));
  it('rejects shares that do not match', () => {
    const r = computeSplits(20000, 'manual', m('80', '70', '40'));
    expect(r.ok).toBe(false);
  });
  it('rejects blank or zero shares', () => expect(computeSplits(20000, 'manual', m('200', '0')).ok).toBe(false));
});

describe('weighted split', () => {
  const w = (...v: string[]) => ids(v.length).map((x, i) => ({ ...x, value: v[i] }));
  it('1:2:1 of ₹200 → 50 / 100 / 50', () => expect(shares(computeSplits(20000, 'weighted', w('1', '2', '1')))).toEqual([5000, 10000, 5000]));
  it('rejects zero, negative and junk weights', () => {
    for (const bad of ['0', '-1', 'abc', '']) expect(computeSplits(20000, 'weighted', w('1', bad)).ok).toBe(false);
  });
  it('odd weights still add up exactly', () => {
    const r = shares(computeSplits(10000, 'weighted', w('1', '1', '1'))) as number[];
    expect(r.reduce((a, b) => a + b, 0)).toBe(10000);
  });
});

describe('money helpers', () => {
  it('parses rupees to paise without floats', () => {
    expect(parseINR('1,234.50')).toBe(123450);
    expect(parseINR('0.1')).toBe(10);
    expect(parseINR('19.99')).toBe(1999);
    expect(parseINR('1.234')).toBeNull();
    expect(parseINR('-5')).toBeNull();
    expect(parseINR('')).toBeNull();
  });
  it('formats INR with Indian grouping', () => {
    expect(formatINR(12345600)).toBe('₹1,23,456');
    expect(formatINR(150)).toBe('₹1.50');
    expect(rupeesStr(5)).toBe('0.05');
  });
});

describe('balances', () => {
  const split = (a: number, b: number) => [{ member_id: 'k', share_amount_paise: a }, { member_id: 'f', share_amount_paise: b }];
  const expenses = [
    { payer_id: 'k', total_amount_paise: 50000, expense_splits: split(25000, 25000) },
    { payer_id: 'f', total_amount_paise: 20000, expense_splits: split(10000, 10000) },
  ];
  it('spec example: Krishna +₹150, friend −₹150', () => {
    const n = computeNets(['k', 'f'], expenses, []);
    expect(n.get('k')).toBe(15000);
    expect(n.get('f')).toBe(-15000);
  });
  it('a repayment settles the balance and is not an expense', () => {
    const n = computeNets(['k', 'f'], expenses, [{ payer_id: 'f', receiver_id: 'k', amount_paise: 15000, status: 'recorded' }]);
    expect([n.get('k'), n.get('f')]).toEqual([0, 0]);
  });
  it('voided settlements and deleted expenses are ignored', () => {
    const n = computeNets(['k', 'f'], [...expenses, { ...expenses[0], deleted_at: 'x' }], [{ payer_id: 'f', receiver_id: 'k', amount_paise: 15000, status: 'voided' }]);
    expect(n.get('k')).toBe(15000);
  });
  it('nets always sum to zero', () => {
    const n = computeNets(['k', 'f'], expenses, []);
    expect([...n.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });
  it('suggests at most n−1 transfers and clears everyone', () => {
    const nets = new Map([['a', 7000], ['b', -3000], ['c', -2000], ['d', -2000]]);
    const t = suggestTransfers(nets);
    expect(t.length).toBeLessThanOrEqual(3);
    const after = new Map(nets);
    for (const x of t) { after.set(x.from, after.get(x.from)! + x.amount); after.set(x.to, after.get(x.to)! - x.amount); }
    expect([...after.values()].every((v) => v === 0)).toBe(true);
  });
});

describe('csv', () => {
  it('escapes quotes and blocks formula injection', () => {
    expect(toCSV([['=SUM(A1)', 'say "hi"', '-12.50', 'a,b']])).toBe(`'=SUM(A1),"say ""hi""",-12.50,"a,b"`);
  });
});
