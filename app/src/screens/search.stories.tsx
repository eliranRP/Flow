import type { SearchRow } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { StoryRoute } from "../ui/story-route";
import { SearchScreen, type SearchSample } from "./search";

/**
 * FLOW-368: the transaction search, one field with סינון beside it, the checks before anything is
 * typed, and the results after. Invented data only. The play functions never focus the field.
 */
const meta = {
  title: "Screens/Search",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function line(id: string, patch: Partial<SearchRow>): SearchRow {
  return {
    id,
    description: "תנועה לדוגמה",
    doc_date: "2026-10-08",
    doc_kind: "invoice",
    amount_net: -100_000n,
    vat_agorot: -18_000n,
    direction: "expense",
    currency: "ILS",
    amount_original: 118_000n,
    project_id: "p1",
    category_id: "c1",
    project_name: "שיפוץ לדוגמה 12",
    category_name: "חומרים",
    supplier_name: "ספק לדוגמה",
    customer_name: null,
    waiting_review: false,
    kept_out: false,
    split_parts: 0,
    loan_matched: false,
    ...patch,
  };
}

const rows: SearchRow[] = [
  line("s1", { doc_date: "2026-10-06", supplier_name: "חומרי בניין לדוגמה", amount_net: -124_000n }),
  line("s2", { doc_date: "2026-10-02", supplier_name: "חומרי בניין לדוגמה", amount_net: -38_650n, waiting_review: true, project_id: null, project_name: null, category_id: null, category_name: null }),
  line("s3", { doc_date: "2026-09-27", supplier_name: "חומרי גמר לדוגמה", amount_net: -210_400n, project_id: "p2", project_name: "וילה לדוגמה" }),
  line("s4", { doc_date: "2026-09-21", supplier_name: null, description: "החזר חומרי גמר", amount_net: 31_000n, direction: "income", category_name: "החזר מספק", project_id: "p2", project_name: "וילה לדוגמה", split_parts: 2 }),
  line("s5", { doc_date: "2026-09-18", supplier_name: null, customer_name: "לקוח לדוגמה", direction: "income", amount_net: 1_500_000n, project_name: "שיפוץ לדוגמה 12", category_id: "c3", category_name: "עבודה" }),
  line("s6", { doc_date: "2026-09-12", supplier_name: "Northwind Traders", currency: "USD", amount_net: -42_990n, category_id: "c4", category_name: "תוכנה", project_id: null, project_name: null }),
  line("s7", { doc_date: "2026-09-03", supplier_name: "ריבית בנק לדוגמה", amount_net: -41_200n, kept_out: true, category_id: "c5", category_name: "ריבית" }),
  line("s8", { doc_date: "2026-08-28", supplier_name: "חשמל לדוגמה", amount_net: -64_000n, project_id: "p2", project_name: "וילה לדוגמה" }),
];

const sample: SearchSample = {
  rows,
  projects: [
    { id: "p1", name: "שיפוץ לדוגמה 12", status: "active" },
    { id: "p2", name: "וילה לדוגמה", status: "active" },
    { id: "p3", name: "פרגולה לדוגמה", status: "finished" },
  ],
  categories: [
    { id: "c1", name: "חומרים", kind: "expense" },
    { id: "c4", name: "תוכנה", kind: "expense" },
    { id: "c5", name: "ריבית", kind: "expense" },
    { id: "c3", name: "עבודה", kind: "income" },
  ],
};

function Search({ entry, data = sample }: { entry: string; data?: SearchSample }) {
  return (
    <StoryRoute entry={entry}>
      <SearchScreen sample={data} />
    </StoryRoute>
  );
}


/** Nothing typed: the last searches and the three checks. */
export const Start: Story = { render: () => <Search entry="/search" /> };

/** Typed text: the count line, then the lines, newest first. */
export const Results: Story = { render: () => <Search entry="/search?q=חומרי" /> };

/** The text names a project: its shortcut row comes first. */
export const ProjectMatch: Story = { render: () => <Search entry="/search?q=וילה" /> };

/** The filter sheet open over the results (dev query, for the board proofs). */
export const FilterSheet: Story = { render: () => <Search entry="/search?q=חומרי&sheet=filters" /> };

/** Nothing matches the text: the es-06 pattern with one way out. */
export const NoResults: Story = { render: () => <Search entry="/search?q=מעליות" /> };

export const Loading: Story = { render: () => <Search entry="/search?q=חומרי" data={{ ...sample, phase: { kind: "loading" } }} /> };
export const Failed: Story = { render: () => <Search entry="/search?q=חומרי" data={{ ...sample, phase: { kind: "error", offline: false } }} /> };
/** FLOW-971: offline, the search runs on the lines already read and says so under the field. */
export const Offline: Story = { render: () => <Search entry="/search?q=חומרי" data={{ ...sample, offline: true }} /> };

/** More lines than one page: the month head of the last month waits, and the count says the total. */
export const MorePages: Story = { render: () => <Search entry="/search?dir=expense" data={{ ...sample, total: 120 }} /> };

/** FLOW-163 (board ReportEntrySearch): "מאזן" names a report. Its row comes first, and no line matches. */
export const ReportShortcut: Story = {
  render: () => <Search entry={`/search?q=${encodeURIComponent("מאזן")}`} />,
  play: async ({ canvasElement }) => {
    const link = await within(canvasElement).findByRole("link", { name: /מאזן/ });
    await expect(link).toHaveAttribute("href", "/reports?kind=balance");
  },
};

/** FLOW-163: "דוחות וילה" offers both reports on that project. */
export const ReportShortcutProject: Story = {
  render: () => <Search entry={`/search?q=${encodeURIComponent("דוחות וילה")}`} />,
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("link", { name: /רווח והפסד · וילה לדוגמה/ });
  },
};

/** FLOW-169: a uuid project, so its reports link is one the reports screen reads as a project. */
const CHIP_PROJECT = "a0000000-0000-4000-8000-000000000169";

/**
 * FLOW-169: with the project chip on, "המאזן?" (a prefix letter and a question mark) opens the
 * balance sheet on that project, as a typed project name does. At 320, in light and dark.
 */
export const ReportShortcutProjectChip: Story = {
  name: "Report shortcut · the project chip at 320",
  globals: { viewport: { value: "flow320", isRotated: false } },
  render: () => (
    <Search
      entry={`/search?q=${encodeURIComponent("המאזן?")}&project=${CHIP_PROJECT}`}
      data={{ ...sample, projects: [...(sample.projects ?? []), { id: CHIP_PROJECT, name: "בית לדוגמה בגבעה", status: "active" }] }}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement.clientWidth).toBeLessThanOrEqual(320);
    const canvas = within(canvasElement);
    const link = await canvas.findByRole("link", { name: /מאזן · בית לדוגמה בגבעה/ });
    await expect(link).toHaveAttribute("href", `/reports?kind=balance&scope=project&project=${CHIP_PROJECT}`);
    await expect(canvas.getByRole("button", { name: "הסרת בית לדוגמה בגבעה" })).toBeInTheDocument();
    const row = link.getBoundingClientRect();
    await expect(row.right).toBeLessThanOrEqual(320);
    await expect(row.left).toBeGreaterThanOrEqual(0);
  },
};

/**
 * FLOW-163 (review r1): a project whose name holds a report's name. The דוחות section comes first,
 * then the project shortcut, then the project's lines.
 */
export const ReportShortcutAboveResults: Story = {
  render: () => (
    <Search
      entry={`/search?q=${encodeURIComponent("מאזן")}`}
      data={{
        ...sample,
        projects: [...(sample.projects ?? []), { id: "p4", name: "בית מאזן לדוגמה", status: "active" }],
        rows: [
          line("m1", { doc_date: "2026-10-05", supplier_name: "חומרי בניין לדוגמה", amount_net: -86_400n, project_id: "p4", project_name: "בית מאזן לדוגמה" }),
          line("m2", { doc_date: "2026-09-22", supplier_name: null, customer_name: "לקוח לדוגמה", direction: "income", amount_net: 920_000n, project_id: "p4", project_name: "בית מאזן לדוגמה", category_id: "c3", category_name: "עבודה" }),
          ...rows,
        ],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const report = await canvas.findByRole("link", { name: /כל הפרויקטים · היום/ });
    const project = canvas.getByRole("link", { name: /בית מאזן לדוגמה.*לדף הפרויקט/ });
    await expect(report.compareDocumentPosition(project) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await expect(canvas.getByText("2 תנועות", { exact: false })).toBeInTheDocument();
  },
};

/**
 * A large income kept out of profit, with a project and a category: its one line ("date · project ·
 * category · לא נספר ברווח") is wider than a phone, so it ends in "…" and the amount stays on screen.
 * The storybook layout sweep checks "Large Amount" stories at 320 and 390.
 */
export const LargeAmount: Story = {
  render: () => (
    <Search
      entry="/search?q=Northwind"
      data={{
        ...sample,
        rows: [
          line("s9", { doc_date: "2026-10-02", supplier_name: null, customer_name: "NORTHWIND PARTNER CAPITAL", direction: "income", currency: "USD", amount_net: 4_960_000n, amount_original: 4_960_000n, vat_agorot: 0n, kept_out: true, project_name: "כללי לדוגמה", category_id: "c6", category_name: "הון בעלים" }),
          ...rows,
        ],
      }}
    />
  ),
};
