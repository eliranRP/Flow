import type { SearchRow } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { StoryRoute } from "../ui/story-route";
import { SearchScreen, type SearchSample } from "./search";

/**
 * FLOW-323 option A and FLOW-402: the transaction search, field and chips at the bottom.
 * Invented data only. The play functions never focus the field.
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
    line_status: "posted",
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
  line("s1", { doc_date: "2026-10-06", supplier_name: "חומרי בניין השרון", amount_net: -124_000n }),
  line("s2", { doc_date: "2026-10-02", supplier_name: "חומרי בניין השרון", amount_net: -38_650n, waiting_review: true, project_id: null, project_name: null, category_id: null, category_name: null }),
  line("s3", { doc_date: "2026-09-27", supplier_name: "חומרי גמר הגליל", amount_net: -210_400n, project_id: "p2", project_name: "וילה לדוגמה" }),
  line("s4", { doc_date: "2026-09-21", supplier_name: null, description: "החזר חומרי גמר", amount_net: 31_000n, direction: "income", category_name: "החזר מספק", project_id: "p2", project_name: "וילה לדוגמה", split_parts: 2 }),
  line("s5", { doc_date: "2026-09-18", supplier_name: null, customer_name: "לקוח לדוגמה", direction: "income", amount_net: 1_500_000n, project_name: "שיפוץ לדוגמה 12", category_id: "c3", category_name: "עבודה" }),
  line("s6", { doc_date: "2026-09-12", supplier_name: "Northwind Traders", currency: "USD", amount_net: -42_990n, category_id: "c4", category_name: "תוכנה", project_id: null, project_name: null }),
  line("s7", { doc_date: "2026-09-03", supplier_name: "ריבית בנק לדוגמה", amount_net: -41_200n, kept_out: true, category_id: "c5", category_name: "ריבית" }),
  line("s8", { doc_date: "2026-08-28", supplier_name: "חשמל השרון", amount_net: -64_000n, line_status: "pending", project_id: "p2", project_name: "וילה לדוגמה" }),
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

const dark = { globals: { theme: "dark" as const } };
const narrow = { parameters: { viewport: { defaultViewport: "flow320" } } };

/** Every line, newest first, with no text typed. */
export const AllLines: Story = { render: () => <Search entry="/search" /> };
export const AllLinesDark: Story = { ...dark, render: () => <Search entry="/search" /> };
export const AllLines320: Story = { ...narrow, render: () => <Search entry="/search" /> };
export const AllLines320Dark: Story = { ...dark, ...narrow, render: () => <Search entry="/search" /> };

/** Typed text, tinted in each name it matches; the count line totals the shown rows. */
export const Results: Story = { render: () => <Search entry="/search?q=חומרי" /> };
export const ResultsDark: Story = { ...dark, render: () => <Search entry="/search?q=חומרי" /> };
export const Results320: Story = { ...narrow, render: () => <Search entry="/search?q=חומרי" /> };
export const Results320Dark: Story = { ...dark, ...narrow, render: () => <Search entry="/search?q=חומרי" /> };

/** FLOW-402: opened from a project's "כל התנועות", with the project chip set. */
export const ProjectChip: Story = { render: () => <Search entry="/search?project=p2" /> };
export const ProjectChipDark: Story = { ...dark, render: () => <Search entry="/search?project=p2" /> };
export const ProjectChip320: Story = { ...narrow, render: () => <Search entry="/search?project=p2" /> };

/** Chips together: expenses, waiting for review. */
export const ExpensesWaiting: Story = { render: () => <Search entry="/search?dir=expense&review=1" /> };

/** Nothing matches the text: the es-06 pattern with one way out. */
export const NoResults: Story = { render: () => <Search entry="/search?q=מעליות" /> };
export const NoResultsDark: Story = { ...dark, render: () => <Search entry="/search?q=מעליות" /> };
export const NoResultsFiltered: Story = { render: () => <Search entry="/search?q=מעליות&dir=income" /> };

/** A company with no lines yet. */
export const NoLines: Story = { render: () => <Search entry="/search" data={{ ...sample, rows: [] }} /> };

export const Loading: Story = { render: () => <Search entry="/search?q=חומרי" data={{ ...sample, phase: { kind: "loading" } }} /> };
export const LoadingDark: Story = { ...dark, render: () => <Search entry="/search?q=חומרי" data={{ ...sample, phase: { kind: "loading" } }} /> };
export const Failed: Story = { render: () => <Search entry="/search?q=חומרי" data={{ ...sample, phase: { kind: "error", offline: false } }} /> };
export const Offline: Story = { render: () => <Search entry="/search" data={{ ...sample, phase: { kind: "error", offline: true } }} /> };
export const OfflineDark: Story = { ...dark, render: () => <Search entry="/search" data={{ ...sample, phase: { kind: "error", offline: true } }} /> };

/** More lines than one page: the month head of the last month waits, and the count says the total. */
export const MorePages: Story = { render: () => <Search entry="/search" data={{ ...sample, total: 120 }} /> };
