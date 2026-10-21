import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { invoicesSample, invoicesSummary } from "../invoices-sample";
import { InvoiceScreen, UnpaidScreen } from "../../screens/flow-screens";
import { TransfersScreen } from "../../screens/transfers-screen";
import { transfersSample } from "../transfers-sample";
import type { DevRoute } from "./types";

/**
 * FLOW-367 proof route: the list with the board's fixture (`?state=done` has no invoice), or one
 * invoice's page with `?invoice=<id>`. Stories and proofs use the same fixture.
 */
export function DevInvoices() {
  const [params] = useSearchParams();
  const state = params.get("state");
  const invoice = params.get("invoice");
  const rows = useMemo(() => invoicesSample(state), [state]);
  const summary = useMemo(() => invoicesSummary(), []);
  if (invoice != null) return <InvoiceScreen sample={rows} summary={summary} invoiceId={invoice} />;
  return <UnpaidScreen sample={rows} summary={summary} />;
}

/** FLOW-941 proof route: two suggested transfers between two Mercury connections (`?state=empty` has none). */
export function DevTransfers() {
  const [params] = useSearchParams();
  const rows = useMemo(() => (params.get("state") === "empty" ? [] : transfersSample()), [params]);
  return <TransfersScreen sample={rows} />;
}

export const invoicesRoutes: DevRoute[] = [
  { path: "invoices", element: <DevInvoices /> },
  { path: "transfers", element: <DevTransfers /> },
];
