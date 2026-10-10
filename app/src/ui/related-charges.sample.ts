import type { PartyCharges } from "@flow/shared";

/** FLOW-431 story data: invented parties and amounts only. */
export const mailboxCharges: PartyCharges = {
  transaction_id: "t1",
  party: { direction: "expense", id: "s-mailbox", name: "Example Mailbox", currency: "USD" },
  month: "2026-10",
  month_amount_minor: -2_299n,
  typical_amount_minor: -1_199n,
  typical_source: "recurring",
  change_percent: 92,
  others: 6,
  months: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((month) => ({
    month,
    amount_minor: month === "2026-10" ? -2_299n : -1_199n,
  })),
  charges: [
    { id: "t1", doc_date: "2026-10-06", amount_minor: -2_299n, pending: false },
    ...["09", "08", "07", "06", "05", "04"].map((m) => ({ id: `t-${m}`, doc_date: `2026-${m}-06`, amount_minor: -1_199n, pending: false })),
  ],
};

export const rentCharges: PartyCharges = {
  transaction_id: "r1",
  party: { direction: "income", id: "c-tenant", name: "שוכר לדוגמה", currency: "ILS" },
  month: "2026-10",
  month_amount_minor: 400_000n,
  typical_amount_minor: 500_000n,
  typical_source: "recurring",
  change_percent: -20,
  others: 3,
  months: [
    { month: "2026-05", amount_minor: 0n },
    { month: "2026-06", amount_minor: 0n },
    { month: "2026-07", amount_minor: 500_000n },
    { month: "2026-08", amount_minor: 500_000n },
    { month: "2026-09", amount_minor: 500_000n },
    { month: "2026-10", amount_minor: 400_000n },
  ],
  charges: [
    { id: "r1", doc_date: "2026-10-01", amount_minor: 400_000n, pending: true },
    { id: "r-09", doc_date: "2026-09-01", amount_minor: 500_000n, pending: false },
    { id: "r-08", doc_date: "2026-08-01", amount_minor: 500_000n, pending: false },
    { id: "r-07", doc_date: "2026-07-01", amount_minor: 500_000n, pending: false },
  ],
};

export const steadyCharges: PartyCharges = {
  ...mailboxCharges,
  month_amount_minor: -1_199n,
  change_percent: 0,
  months: mailboxCharges.months.map((m) => ({ ...m, amount_minor: -1_199n })),
  charges: mailboxCharges.charges.map((c) => ({ ...c, amount_minor: -1_199n })),
};

export const cheaperCharges: PartyCharges = {
  ...mailboxCharges,
  month_amount_minor: -699n,
  change_percent: -42,
  typical_source: "earlier_months",
  months: mailboxCharges.months.map((m) => ({ ...m, amount_minor: m.month === "2026-10" ? -699n : -1_199n })),
  charges: mailboxCharges.charges.map((c) => (c.id === "t1" ? { ...c, amount_minor: -699n } : c)),
};
