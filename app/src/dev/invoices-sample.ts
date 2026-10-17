import { israelToday, shiftDays } from "../ui/date-math";
import type { UnpaidInvoice, UnpaidSummary } from "../unpaid";

/**
 * FLOW-367 fixture: the board's amounts, counts and order, with invented names and project lines.
 * Dates are counted back from today, so the days open match the board (34, 19 and 5).
 */
export function invoicesSample(state?: string | null): UnpaidInvoice[] {
  if (state === "done") return [];
  const today = israelToday();
  return [
    {
      id: "inv-1043",
      doc_number: "1043",
      description: "עבודה",
      doc_date: shiftDays(today, -34),
      customer_name: "Okafor",
      project_name: "Okafor · עבודת לקוח",
      open_gross_agorot: 1_250_000n,
      open_net_agorot: 1_250_000n,
      currency: "USD",
      direction: "income",
      marked_paid_at: null,
      document_url: "https://pay.sumit.co.il/example/inv-1043",
      match: null,
    },
    {
      id: "inv-1047",
      doc_number: "1047",
      description: "תיקון",
      doc_date: shiftDays(today, -19),
      customer_name: "Larkspur HOA",
      project_name: "Larkspur · תיקון גג",
      open_gross_agorot: 560_000n,
      open_net_agorot: 560_000n,
      currency: "USD",
      direction: "income",
      marked_paid_at: null,
      document_url: "https://pay.sumit.co.il/example/inv-1047",
      match: null,
    },
    {
      id: "inv-1051",
      doc_number: "1051",
      description: "מטבח",
      doc_date: shiftDays(today, -5),
      customer_name: "R. Chen · מטבח",
      project_name: "Chen · עבודת לקוח",
      open_gross_agorot: 320_000n,
      open_net_agorot: 320_000n,
      currency: "USD",
      direction: "income",
      marked_paid_at: null,
      document_url: "https://pay.sumit.co.il/example/inv-1051",
      match: {
        transaction_id: "tx-1051",
        date: shiftDays(today, -1),
        account_name: "Mercury",
        raw_description: "ZELLE FROM R CHEN",
        amount_minor: 320_000n,
      },
    },
  ];
}

/** The summary card's figures: 27,000 paid since the 1st of last month; the last sync 12 minutes ago. */
export function invoicesSummary(): UnpaidSummary {
  const today = israelToday();
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const issuedSince = month === 1 ? `${String(year - 1)}-12-01` : `${String(year)}-${String(month - 1).padStart(2, "0")}-01`;
  return {
    paid_agorot: 2_700_000n,
    issued_since: issuedSince,
    last_sync_at: new Date(Date.now() - 12 * 60_000).toISOString(),
  };
}
