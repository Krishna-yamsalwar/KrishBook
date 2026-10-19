# SplitLedger

A calm shared-expense tracker for friends, roommates and couples. Everyone adds their own expenses, SplitLedger splits them (equal, percentage, exact amounts or weights) and keeps a live tally of who owes whom.

**Stack:** React + Vite + TypeScript · Tailwind · Supabase (Postgres, Auth, RLS, Realtime) · Recharts · Vercel

## How it's built (read this first)

- **All money is integer paise.** No floats anywhere in storage or calculation.
- **The database is the authority.** The browser can only *read* tables (RLS limits that to groups you belong to). Every write goes through a `SECURITY DEFINER` Postgres function (`create_expense`, `record_settlement`, `join_group`…) that re-checks membership, recomputes the split itself, and writes the audit log in the same transaction.
- **The split preview and the server use the same algorithm** (largest remainder; ties go to the lowest member id), so what you see is what gets saved. `src/lib/money.ts` mirrors `_compute_splits` in the migration.
- **Double submits are harmless.** Each form sends a request id; the server returns the original row instead of creating a duplicate. Group-level advisory locks serialize simultaneous writes.
- **Edits are optimistic-locked.** Editing sends the `updated_at` you loaded. If someone else changed it first, you get a clear message instead of silently overwriting.
- **Audit log is append-only** for members: they can read it, and nothing but the functions can write it.

### One deliberate difference from the spec

The spec's formula says `net = paid − shares + settlements received − settlements paid`. That sign is reversed: if a friend owes you ₹150 and pays it, they would end at −₹300. SplitLedger uses
**`net = paid − shares + repayments made − repayments received`**, so a repayment moves you toward zero. The spec's own ₹500/₹200 example works and is covered by tests.

Other small choices: only the group **owner** creates invites (single-use, 72-hour, stored hashed). Repayments are capped at what the payer owes and what the receiver is owed. Repayments are labelled **Recorded**, never "verified". Emails aren't stored in `profiles` (Auth keeps them), so members can't see each other's email.

## 1. Run it locally

```bash
npm install
cp .env.example .env      # then fill in the two values
npm run dev
```

## 2. Set up Supabase

1. Create a project at supabase.com.
2. **SQL Editor → New query**, paste `supabase/migrations/001_splitledger.sql` and run it, then do the same with `002_edit_settlements.sql` (adds repayment editing). (Or with the CLI: `supabase link` then `supabase db push`.) Run it once, as the default `postgres` role.
3. **Project Settings → API**: copy the Project URL and the **anon** key into `.env`. Never use the `service_role` key in this app.
4. **Authentication → URL Configuration**: set *Site URL* to your Vercel URL and add `http://localhost:5173/**` and `https://YOUR-APP.vercel.app/**` to *Redirect URLs*.
5. **Authentication → Providers → Email**: for quick two-account testing you can turn off "Confirm email". Keep it on for real use.
6. Realtime is enabled by the migration (`alter publication supabase_realtime …`). Check **Database → Replication** shows the four tables.

## 3. Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New → Project**, import the repo (framework preset: Vite, defaults are fine).
3. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Deploy. `vercel.json` already rewrites all routes to `index.html`, so deep links like `/join/<code>` work.
5. Make sure the deployed URL is in Supabase's redirect URLs (step 2.4).

**Backups:** the free Supabase plan has no point-in-time backups. Use the CSV exports (History, Repayments, Reports) as a periodic copy, or upgrade to a plan with daily backups.

## 4. Tests

```bash
npm test
```

Covers the split engine (equal for 2/3/5 people, percentages, exact amounts that match and don't, zero/invalid weights, fractional paise, determinism), balance maths (the spec's ₹500/₹200 example, repayments, voided repayments, deleted expenses, nets summing to zero), settlement suggestions (≤ n−1 transfers) and CSV escaping.

### Manual checklist (needs two accounts)

Use two browsers (or one normal + one private window) with two accounts.

| Scenario | How to check |
|---|---|
| Join a group | A creates a group → *Create invite link* → B opens the link. Reusing the link shows "already used". |
| Paid by one, entered by another | B adds an expense with A as *Paid by*. The detail page shows both "Paid by" and "Added by". |
| Only some members | Untick a member; they show "not in this split" in History. |
| Simultaneous adds | Both users save at the same moment; both rows appear on both screens (realtime). |
| Double-click Save | Only one expense is created. |
| Edit / delete | Creator or owner can; others can't (the database rejects it, not just the UI). Change history shows before → after. |
| Conflicting edit | Open the same expense on two devices, save on one, then the other shows "Someone else changed this expense". |
| Repayment | Record it, balances move toward zero. Edit the amount or people and balances follow. Void it, balances return. Overpaying is refused. |
| Another group's data | Paste a group URL you're not in → "can't find that group". |
| Persistence | Sign out/in, or open on another device: everything is still there. |
| Reconcile | Export History CSV; the sum of *Total (INR)* equals "spent" shown in History and Reports. |

## 5. Project layout

```
supabase/migrations/001_splitledger.sql   tables, RLS, split engine, all write functions
src/lib/money.ts                          paise parsing/formatting + split engine (tested)
src/lib/balances.ts                       net balances + minimal-transfer suggestions (tested)
src/components/GroupLayout.tsx            loads a group, live updates, navigation
src/components/ExpenseForm.tsx            add/edit expense with live share preview
src/pages/*                               one file per route
```

## Known limits

- Lists load up to 1,000 rows per group (Supabase's default API cap). Fine for a household; add pagination for very large groups.
- No "leave group" or remove-member flow yet; the schema keeps history intact if you add one.
- Email/password sign-in only.
