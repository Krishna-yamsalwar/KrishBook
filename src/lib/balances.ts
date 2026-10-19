export interface Transfer { from: string; to: string; amount: number }

interface ExpenseLike { payer_id: string; total_amount_paise: number; deleted_at?: string | null; expense_splits: { member_id: string; share_amount_paise: number }[] }
interface SettlementLike { payer_id: string; receiver_id: string; amount_paise: number; status: string }

/**
 * Same maths as the database's group_balances():
 * net = paid − shares + repayments made − repayments received.
 * Positive = should receive money. Negative = owes money.
 */
export function computeNets(memberIds: string[], expenses: ExpenseLike[], settlements: SettlementLike[]): Map<string, number> {
  const net = new Map(memberIds.map((id) => [id, 0]));
  const add = (id: string, n: number) => net.set(id, (net.get(id) ?? 0) + n);
  for (const e of expenses) {
    if (e.deleted_at) continue;
    add(e.payer_id, e.total_amount_paise);
    for (const s of e.expense_splits) add(s.member_id, -s.share_amount_paise);
  }
  for (const s of settlements) {
    if (s.status !== 'recorded') continue;
    add(s.payer_id, s.amount_paise);
    add(s.receiver_id, -s.amount_paise);
  }
  return net;
}

/** Greedy matching of the biggest debtor with the biggest creditor: at most (people − 1) transfers. */
export function suggestTransfers(nets: Map<string, number> | Record<string, number>): Transfer[] {
  const entries = nets instanceof Map ? [...nets.entries()] : Object.entries(nets);
  const byAmount = (a: [string, number], b: [string, number]) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1);
  const creditors = entries.filter(([, n]) => n > 0).map(([id, n]) => [id, n] as [string, number]).sort(byAmount);
  const debtors = entries.filter(([, n]) => n < 0).map(([id, n]) => [id, -n] as [string, number]).sort(byAmount);
  const out: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i][1], creditors[j][1]);
    out.push({ from: debtors[i][0], to: creditors[j][0], amount });
    debtors[i][1] -= amount;
    creditors[j][1] -= amount;
    if (debtors[i][1] === 0) i++;
    if (creditors[j][1] === 0) j++;
  }
  return out;
}
