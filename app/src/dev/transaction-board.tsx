import { useSearchParams } from "react-router-dom";
import { type TransactionDetail } from "@flow/shared";
import { type TxnMeta } from "../txn-meta";
import { TransactionScreen } from "../screens/transaction-screen";
import { boardCharges, loanCharges } from "../ui/related-charges.sample";

/** The board's month the cards open from: the back link reads its side (יצא). */
const BOARD_FROM = "/cash/2026-10/out/USD";

/** The bank line behind the board's card: its account makes the meta read "חשבונית + שורת בנק". */
const BOARD_BANK_LINE: TxnMeta = {
  transaction_id: "t-board",
  method: "card",
  card_last4: null,
  memo: null,
  account: "Example Checking ••1234",
  counterparty: null,
  bank_description: null,
};

const BOARD_TXN: NonNullable<TransactionDetail> = {
  id: "t-board",
  description: "Hardwood Depot",
  direction: "expense",
  doc_date: "2026-10-08",
  amount_gross: -128450n,
  amount_net: -128450n,
  vat_amount: 0n,
  vat_status: "source",
  source: "sumit",
  project_id: "p1",
  project_name: "Elmwood • flip",
  category_id: "c1",
  category_name: "חומרים",
  supplier_name: "Hardwood Depot",
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
        sampleProjects={[{ id: "p1", name: "Elmwood • flip" }]}
        sampleCategories={[{ id: "c1", name: "חומרים" }]}
        sampleMeta={BOARD_BANK_LINE}
        sampleFrom={BOARD_FROM}
        sampleNoFooter
      />
    );
  }
  if (params.get("board") === "loan") {
    return (
      <TransactionScreen
        sample={{
          ...BOARD_TXN,
          id: "t-loan",
          doc_date: "2026-10-07",
          description: "Harbor Loan Servicing",
          supplier_name: "Harbor Loan Servicing",
          project_name: "Maple Ave • דופלקס להשכרה",
          category_name: "תשלומי הלוואה",
          amount_gross: -395700n,
          amount_net: -395700n,
          review_status: "approved",
          review_id: null,
          paid: false,
        }}
        sampleProjects={[{ id: "p1", name: "Maple Ave • דופלקס להשכרה" }]}
        sampleCategories={[{ id: "c1", name: "תשלומי הלוואה" }]}
        sampleRecurring={{
          transaction_id: "t-loan",
          party: { direction: "expense", id: "s-loan", name: "Harbor Loan Servicing", currency: "USD" },
          recurring: true,
          override: null,
          detected: true,
          typical_day: 7,
          typical_amount_minor: 395700n,
          pace: "month",
          detected_pace: "month",
        }}
        sampleCharges={loanCharges}
        sampleFrom={BOARD_FROM}
        sampleNoFooter
      />
    );
  }
  if (params.get("board") === "recurring") {
    return (
      <TransactionScreen
        sample={{ ...BOARD_TXN, amount_gross: -124000n, amount_net: -124000n, doc_date: "2026-10-11" }}
        sampleProjects={[{ id: "p1", name: "Elmwood • flip" }]}
        sampleCategories={[{ id: "c1", name: "חומרים" }]}
        sampleRecurring={{
          transaction_id: "t-board",
          party: { direction: "expense", id: "s-sample", name: "Hardwood Depot", currency: "USD" },
          recurring: true,
          override: null,
          detected: true,
          typical_day: 11,
          typical_amount_minor: 98000n,
          pace: "month",
          detected_pace: "month",
        }}
        sampleCharges={boardCharges}
        sampleFrom={BOARD_FROM}
        sampleNoFooter
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
        project_name: "Maple St",
        category_id: "c1",
        category_name: "חומרים",
        supplier_name: "ספק",
        customer_name: null,
        paid: true,
        open_gross_agorot: null,
        allocations: [],
      }}
      sampleProjects={[{ id: "p1", name: "Maple St" }, { id: "p2", name: "Pine Ridge" }]}
      sampleCategories={[{ id: "c1", name: "חומרים" }, { id: "c2", name: "הובלה" }]}
    />
  );
}
