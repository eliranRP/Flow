import type { SearchRow } from "@flow/shared";

/**
 * Invented lines for the search e2e (FLOW-323). Imported only from an `import.meta.env.DEV`
 * branch, so the production bundle drops this module. The ids are the dev step cards
 * (`/transactions/t-step-N` in a dev build), so a result opens a card with the same supplier.
 */
const projects = [
  { id: "p1", name: "שיפוץ הרצל 12", status: "active" },
  { id: "p2", name: "וילה רעננה", status: "active" },
] as const;

const categories = [
  { id: "c1", name: "חומרים", kind: "expense" as const },
  { id: "c2", name: "עבודה", kind: "income" as const },
];

function row(n: number, date: string, project: (typeof projects)[number] | null, waiting = false): SearchRow {
  return {
    id: `t-step-${String(n)}`,
    description: `תנועה ${String(n)}`,
    doc_date: date,
    doc_kind: "invoice",
    amount_net: BigInt(-n * 10_000),
    vat_agorot: BigInt(-n * 1_800),
    direction: "expense",
    currency: "ILS",
    amount_original: BigInt(n * 11_800),
    line_status: "posted",
    project_id: project?.id ?? null,
    category_id: waiting ? null : "c1",
    project_name: project?.name ?? null,
    category_name: waiting ? null : "חומרים",
    supplier_name: `ספק ${String(n)}`,
    customer_name: null,
    waiting_review: waiting,
    kept_out: false,
    split_parts: 0,
    loan_matched: false,
  };
}

export const searchE2eFixture = {
  projects: [...projects],
  categories,
  rows: [
    row(1, "2026-10-06", projects[0]),
    row(2, "2026-10-04", projects[1]),
    row(3, "2026-10-02", projects[0]),
    row(4, "2026-09-28", null, true),
    row(5, "2026-09-21", projects[1]),
    row(6, "2026-09-14", projects[0]),
  ],
};
