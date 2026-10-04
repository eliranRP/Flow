import page1 from "./fixtures/transactions-desc-page1.json" with { type: "json" };
import page2 from "./fixtures/transactions-desc-page2.json" with { type: "json" };
import accountsFile from "./fixtures/accounts.json" with { type: "json" };
import creditFile from "./fixtures/credit.json" with { type: "json" };
import treasuryFile from "./fixtures/treasury.json" with { type: "json" };
import { normalizeMercury } from "../../../functions/_shared/connectors/mercury/normalize.ts";
import type { CanonicalLine, NormalizeContext } from "../../../functions/_shared/connectors/types.ts";

export const postedLines = [...page1.transactions, ...page2.transactions];

export function fixtureContext(extra: Partial<NormalizeContext> = {}): NormalizeContext {
  return {
    ownAccountIds: [
      ...accountsFile.accounts.map((account) => account.id),
      ...creditFile.accounts.map((account) => account.id),
      ...treasuryFile.accounts.map((account) => account.id),
    ],
    ownCounterpartyIds: [],
    vatRateBp: 1800,
    exemptSupplierNames: [],
    exemptSupplierIds: [],
    linkedDocuments: [],
    ...extra,
  };
}

function project(line: CanonicalLine) {
  return {
    external_id: line.external_id,
    direction: line.direction,
    line_status: line.line_status,
    doc_kind: line.doc_kind,
    currency: line.currency,
    amount_original: line.amount_original,
    amount_negated: line.amount_negated,
    doc_date: line.doc_date,
    cash_date: line.cash_date,
    source_account_id: line.source_account_id,
    counterparty: line.counterparty,
    description: line.description,
    vat: line.vat,
    category_hint: line.category_hint,
    provider_meta: line.provider_meta,
  };
}

export function postedSnapshot() {
  const imported: CanonicalLine[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { external_id: string; reason: string }[] = [];
  for (const row of postedLines) {
    const result = normalizeMercury(row, fixtureContext());
    if (!result.ok) {
      skipped[result.skip] = (skipped[result.skip] ?? 0) + 1;
      skippedRows.push({ external_id: row.id, reason: result.skip });
      continue;
    }
    imported.push(result.line);
  }
  skippedRows.sort((a, b) => a.external_id.localeCompare(b.external_id));
  return {
    imported_count: imported.length,
    pending_count: imported.filter((line) => line.line_status === "pending").length,
    skipped,
    skipped_rows: skippedRows,
    lines: imported.map(project).sort((a, b) => a.external_id.localeCompare(b.external_id)),
  };
}
