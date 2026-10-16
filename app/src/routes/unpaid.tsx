import { lazy } from "react";
import { Route } from "react-router-dom";
import { screenLoaders } from "../screen-loaders";

const UnpaidScreen = lazy(() => screenLoaders.unpaid().then((m) => ({ default: m.UnpaidScreen })));
const InvoiceScreen = lazy(() => screenLoaders.invoice().then((m) => ({ default: m.InvoiceScreen })));

/** Open invoices: the bills that are not paid yet. */
export function UnpaidRoute() {
  return <Route path="unpaid" element={<UnpaidScreen />} />;
}

/** FLOW-367: one open invoice, pushed from the list. */
export function UnpaidInvoiceRoute() {
  return <Route path="unpaid/:invoiceId" element={<InvoiceScreen />} />;
}
