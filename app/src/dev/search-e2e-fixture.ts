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

type SearchE2eFixture = {
  projects: Array<(typeof projects)[number]>;
  categories: typeof categories;
  rows: SearchRow[];
};

let built: SearchE2eFixture | null = null;

/**
 * A function, so a production build that never calls it drops the module (a top-level call would
 * keep it). Built once, so every render gets the same object.
 */
export function searchE2eFixture(): SearchE2eFixture {
  built ??= {
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
  return built;
}

const usd = (minor: number, direction: "income" | "expense" = "expense") => ({
  amount: BigInt(direction === "income" ? minor : -minor),
  direction,
});

type BoardLine = {
  date: string;
  payee: string;
  project: string | null;
  category: string | null;
  amount: number;
  direction?: "income" | "expense";
  waiting?: boolean;
};

const boardProjects = [
  { id: "birch-lane", name: "Birch Lane", status: "active" },
  { id: "juniper-ct", name: "Juniper Ct", status: "active" },
  { id: "elm-row", name: "Elm Row", status: "active" },
  { id: "sable-ct", name: "Sable Ct", status: "active" },
  { id: "okafor", name: "Okafor", status: "active" },
] as const;

const boardLines: BoardLine[] = [
  { date: "2026-10-10", payee: "Northline Supply", project: "juniper-ct", category: "תיקונים ותחזוקה", amount: 52_440 },
  { date: "2026-10-05", payee: "Northline Supply", project: "birch-lane", category: "חומרים", amount: 894_017 },
  { date: "2026-09-23", payee: "Northline Supply", project: "birch-lane", category: "חומרים", amount: 321_255 },
  { date: "2026-09-16", payee: "Northline Supply Pro", project: "birch-lane", category: "חומרים", amount: 248_000 },
  { date: "2026-09-09", payee: "Northline Supply", project: "sable-ct", category: "חומרים", amount: 111_832, waiting: true },
  { date: "2026-08-23", payee: "Northline Supply", project: "juniper-ct", category: "תיקונים ותחזוקה", amount: 18_000 },
  { date: "2026-08-12", payee: "Northline Supply", project: "birch-lane", category: "חומרים", amount: 460_590 },
  { date: "2026-10-09", payee: "D. Avery", project: "elm-row", category: "שכירות", amount: 185_000, direction: "income" },
  { date: "2026-10-07", payee: "Okafor", project: "okafor", category: "עבודות לקוח", amount: 1_500_000, direction: "income" },
  { date: "2026-10-01", payee: "Harbor Lending", project: "birch-lane", category: "ריבית הלוואות", amount: 183_750 },
  { date: "2026-10-08", payee: "Quarry Lane Drywall", project: "birch-lane", category: "עבודה", amount: 347_575 },
  { date: "2026-10-06", payee: "Coastline Power", project: "sable-ct", category: "חשמל ומים", amount: 41_200, waiting: true },
];

/**
 * The board's sample (FLOW-368 brief §5): the same amounts, dates, counts and order, with the
 * names invented. Dev only; `?preview=search` opens it.
 */
export function searchBoardFixture(): { projects: Array<(typeof boardProjects)[number]>; categories: Array<{ id: string; name: string; kind: "expense" | "income" }>; rows: SearchRow[] } {
  const rows = boardLines.map((line, index): SearchRow => {
    const sign = usd(line.amount, line.direction ?? "expense");
    const project = boardProjects.find((item) => item.id === line.project) ?? null;
    return {
      id: `board-${String(index + 1)}`,
      description: line.payee,
      doc_date: line.date,
      doc_kind: "invoice",
      amount_net: sign.amount,
      vat_agorot: 0n,
      direction: sign.direction,
      currency: "USD",
      amount_original: sign.amount,
      line_status: line.waiting ? "pending" : "posted",
      project_id: project?.id ?? null,
      category_id: line.category == null ? null : "board-cat",
      project_name: project?.name ?? null,
      category_name: line.category,
      supplier_name: sign.direction === "income" ? null : line.payee,
      customer_name: sign.direction === "income" ? line.payee : null,
      waiting_review: line.waiting === true,
      kept_out: false,
      split_parts: 0,
      loan_matched: false,
    };
  });
  return {
    projects: [...boardProjects],
    categories: [{ id: "board-cat", name: "חומרים", kind: "expense" }],
    rows,
  };
}
