// The pure part of the fixture replay, with no fixture imports, so generate_fixtures.ts can
// build canonical-snapshot.json even when the fixtures are missing or broken.
import { normalizeMercury } from "../../../functions/_shared/connectors/mercury/normalize.ts";
import type { CanonicalLine, NormalizeContext } from "../../../functions/_shared/connectors/types.ts";

export function fixtureContext(
  extra: Partial<NormalizeContext> = {},
  ownAccountIds: string[],
): NormalizeContext {
  return {
    ownAccountIds,
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

/** The snapshot of any posted rows; generate_fixtures.ts builds canonical-snapshot.json with it. */
export function snapshotOf(rows: readonly Record<string, unknown>[], ownAccountIds: string[]) {
  const imported: CanonicalLine[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { external_id: string; reason: string }[] = [];
  for (const row of rows) {
    const result = normalizeMercury(row, fixtureContext({}, ownAccountIds));
    if (!result.ok) {
      skipped[result.skip] = (skipped[result.skip] ?? 0) + 1;
      skippedRows.push({ external_id: String(row.id), reason: result.skip });
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
