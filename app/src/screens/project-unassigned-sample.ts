import type { SearchRow } from "@flow/shared";
import { devProjectsCash } from "../dev/projects-sample";
import type { UnassignedSample } from "./project-unassigned-screen";

/** FLOW-1044: invented lines with no project, for the stories and tests of the lines-with-no-project list. */
function line(over: Partial<SearchRow> & { id: string; description: string; doc_date: string; amount_net: bigint }): SearchRow {
  return {
    direction: "expense",
    currency: "USD",
    project_id: null,
    category_id: null,
    project_name: null,
    category_name: null,
    supplier_name: null,
    customer_name: null,
    waiting_review: false,
    kept_out: false,
    split_parts: 0,
    loan_matched: false,
    ...over,
  };
}

export const UNASSIGNED_SAMPLE: UnassignedSample = {
  rows: [
    line({ id: "u1", description: "Hardware store", supplier_name: "Hardware store", doc_date: "2026-10-09", amount_net: -110_000n, category_id: "c-lark", category_name: "Lark Hill · repairs" }),
    line({ id: "u2", description: "Moving truck", supplier_name: "Moving truck", doc_date: "2026-10-06", amount_net: -40_000n, category_id: "c-moving", category_name: "הובלות" }),
    line({ id: "u3", description: "Card payment", doc_date: "2026-10-02", amount_net: -12_500n }),
  ],
  projects: devProjectsCash.projects,
};

/** Many lines, for the long-content story. */
export const UNASSIGNED_LONG: UnassignedSample = {
  rows: Array.from({ length: 24 }, (_, index) => line({
    id: `l${String(index)}`,
    description: `Supplier with a long name that runs on ${String(index + 1)}`,
    supplier_name: `Supplier with a long name that runs on ${String(index + 1)}`,
    doc_date: `2026-${index < 12 ? "10" : "09"}-${String((index % 12) + 10)}`,
    amount_net: -BigInt((index + 1) * 12_345),
    category_id: "c-misc",
    category_name: "שונות וכלליות שלא נכנסו לקטגוריה אחרת",
  })),
  projects: devProjectsCash.projects,
};
