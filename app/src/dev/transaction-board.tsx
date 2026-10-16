import { useSearchParams } from "react-router-dom";
import { type TransactionDetail } from "@flow/shared";
import { TransactionScreen } from "../screens/transaction-screen";
import { mailboxCharges } from "../ui/related-charges.sample";

const BOARD_TXN: NonNullable<TransactionDetail> = {
  id: "t-board",
  description: "ספק לדוגמה",
  direction: "expense",
  doc_date: "2026-10-08",
  amount_gross: -128450n,
  amount_net: -128450n,
  vat_amount: 0n,
  vat_status: "source",
  source: "sumit",
  project_id: "p1",
  project_name: "פרויקט לדוגמה",
  category_id: "c1",
  category_name: "חומרים",
  supplier_name: "ספק לדוגמה",
  customer_name: null,
  currency: "USD",
  paid: false,
  open_gross_agorot: null,
  review_status: "open",
  review_id: "r1",
  allocations: [],
};

export function DevTransactionBoard() {
  const [params] = useSearchParams();
  if (params.get("board") === "1") {
    return (
      <TransactionScreen
        sample={BOARD_TXN}
        sampleProjects={[{ id: "p1", name: "פרויקט לדוגמה" }]}
        sampleCategories={[{ id: "c1", name: "חומרים" }]}
      />
    );
  }
  if (params.get("board") === "recurring") {
    return (
      <TransactionScreen
        sample={BOARD_TXN}
        sampleProjects={[{ id: "p1", name: "פרויקט לדוגמה" }]}
        sampleCategories={[{ id: "c1", name: "חומרים" }]}
        sampleRecurring={{
          transaction_id: "t-board",
          party: { direction: "expense", id: "s-sample", name: "ספק לדוגמה", currency: "ILS" },
          recurring: true,
          override: null,
          detected: true,
          typical_day: 4,
          typical_amount_minor: 1199n,
          pace: "month",
          detected_pace: "month",
        }}
        sampleCharges={mailboxCharges}
      />
    );
  }
  return (
    <TransactionScreen
      sample={{
        id: "t-manual",
        description: "רשומה ידנית",
        direction: "expense",
        doc_date: "2026-09-12",
        amount_gross: -118n,
        amount_net: -100n,
        vat_amount: -18n,
        vat_status: "assumed",
        source: "manual",
        project_id: "p1",
        project_name: "שיפוץ הרצל 12",
        category_id: "c1",
        category_name: "חומרים",
        supplier_name: "ספק",
        customer_name: null,
        paid: true,
        open_gross_agorot: null,
        allocations: [],
      }}
      sampleProjects={[{ id: "p1", name: "שיפוץ הרצל 12" }, { id: "p2", name: "וילה רעננה" }]}
      sampleCategories={[{ id: "c1", name: "חומרים" }, { id: "c2", name: "הובלה" }]}
    />
  );
}
