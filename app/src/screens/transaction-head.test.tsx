import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TransactionDetail } from "@flow/shared";
import type { TxnMeta } from "../txn-meta";
import { jevNote, TxnFooter, txnSourceLabel, txnStatus } from "./transaction-head";

const base = {
  id: "t1",
  description: "EXAMPLE OFFICE SUITE",
  direction: "expense",
  doc_date: "2026-09-10",
  amount_net: -125_000n,
  vat_amount: 0n,
  currency: "USD",
  review_status: "approved",
  paid: true,
  open_gross_agorot: null,
} as unknown as NonNullable<TransactionDetail>;

const meta = (partial: Partial<TxnMeta>) => partial as TxnMeta;

describe("txnStatus (FLOW-366)", () => {
  it("reads an open review as waiting, and approved with its payment", () => {
    expect(txnStatus({ ...base, review_status: "open" })).toEqual({ text: "ממתין לאישור", open: true });
    expect(txnStatus(base)).toEqual({ text: "מאושר · שולם", open: false });
    expect(txnStatus({ ...base, paid: false })).toEqual({ text: "מאושר", open: false });
  });

  it("draws no status when neither the review nor the payment is known", () => {
    expect(txnStatus({ ...base, review_status: null, paid: null })).toBeNull();
  });
});

describe("source and Jev copy", () => {
  it("names the source, with the bank line when a SUMIT invoice has one", () => {
    expect(txnSourceLabel("mercury", false)).toBe("שורת בנק");
    expect(txnSourceLabel("sumit", true)).toBe("חשבונית + שורת בנק");
    expect(txnSourceLabel("sumit", false)).toBe("חשבונית");
    expect(txnSourceLabel("photo", false)).toBe("חשבונית מצולמת");
    expect(txnSourceLabel("manual", false)).toBe("רשומה ידנית");
  });

  it("says how the line was classified", () => {
    expect(jevNote("open")).toBe("הצעה, עוד לא אושרה.");
    expect(jevNote("approved")).toBe("אושר ידנית.");
    expect(jevNote(null)).toBe("שויך אוטומטית לפי חוק לספק הזה.");
  });
});

describe("TxnFooter", () => {
  it("shows the bank account's last 4 after its name, in the footer's bank line (FLOW-707)", () => {
    render(<TxnFooter txn={base} meta={meta({ account: "EXAMPLE OFFICE SUITE ••6789", bank_description: "EXAMPLE OFFICE SUITE 123456789" })} />);
    expect(screen.getByText("EXAMPLE OFFICE SUITE ••6789")).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("EXAMPLE OFFICE SUITE 123456789")).toBeInTheDocument();
  });
});
