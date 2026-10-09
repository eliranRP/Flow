// Shared fixtures for the Screens/Routes stories, split out of screens.stories.tsx (FLOW-807).
import type { Dashboard, ProfitMonths, ReviewRow } from "@flow/shared";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { skippedReviewQueryKey, type SkippedReviewRow } from "../screens/review-skipped";
import { within } from "@storybook/test";

export const sampleDashboard: Dashboard = {
  company_id: "story",
  name: "Flow Test",
  vat_registered: true,
  basis: "invoiced",
  from: "2026-09-01",
  to: "2026-09-28",
  income_agorot: 131_000_000n,
  direct_agorot: 90_000_000n,
  shared_agorot: 0n,
  overhead_agorot: 21_000_000n,
  expense_agorot: 111_000_000n,
  net_profit_agorot: 20_000_000n,
  prev_income_agorot: 140_000_000n,
  prev_expense_agorot: 118_000_000n,
  prev_net_agorot: 22_000_000n,
  active_projects: 3,
  review_count: 7,
  by_currency: [],
  projects: [
    { id: "a", name: "בניין מגורים חולון", status: "active", income_agorot: 30_000_000n, direct_agorot: 22_000_000n, shared_agorot: 0n, profit_before_shared_agorot: 8_000_000n, profit_agorot: 8_000_000n, by_currency: [] },
    { id: "b", name: "וילה רעננה", status: "active", income_agorot: 18_000_000n, direct_agorot: 13_000_000n, shared_agorot: 0n, profit_before_shared_agorot: 5_000_000n, profit_agorot: 5_000_000n, by_currency: [] },
    { id: "c", name: "מגדל משרדים פ״ת", status: "active", income_agorot: 25_000_000n, direct_agorot: 21_000_000n, shared_agorot: 0n, profit_before_shared_agorot: 4_000_000n, profit_agorot: 4_000_000n, by_currency: [] },
  ],
};

export const filedTodayCount = 12;

export const sampleReview: ReviewRow = {
  id: "r1",
  transaction_id: "t1",
  description: "חשבונית חשמל",
  doc_date: "2026-09-21",
  amount_net: -850_000n,
  vat_agorot: 153_000n,
  direction: "expense",
  reason: null,
  project_id: "a",
  category_id: "c1",
  project_name: "וילה רעננה",
  category_name: "חומרים",
  project_suggested: true,
  category_suggested: true,
  confidence: 92,
  supplier_name: "חומרי בניין לדוגמה בע״מ",
  auto_approved_today: filedTodayCount,
};

export const exampleLabel = "נתוני דוגמה · Example data";

export function ExampleBar() {
  return <p className="ui-example-bar t-hint">{exampleLabel}</p>;
}

export const exampleOnBand = <span className="ui-example t-hint">{exampleLabel}</span>;

export const bareReview: ReviewRow = {
  ...sampleReview,
  id: "r0",
  project_id: null,
  category_id: null,
  project_name: null,
  category_name: null,
  confidence: null,
};

export function storyBody(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
}

// FLOW-501: Settings after the change, and the two pages it opens. Invented data only.
export const pagesBusiness = {
  name: "אלפא בנייה בע״מ",
  email: "owner@example.com",
  companyId: 1000,
  lastError: null,
  connected: true,
  mercuryConnected: true,
  mercuryLastSyncAt: "2026-10-07T09:00:00.000Z",
  jev: { enabled: false, mode: "shadow" as const, threshold: 0.9, status: "ready" as const },
  assistant: { state: "connected" as const, scope: "read_write" as const, id: "mcp-1" },
};

export const at320 = { parameters: { viewport: { defaultViewport: "flow320" } } };
export const dark = { globals: { theme: "dark" } };

/** FLOW-309. Puts the skipped list in the story's cache under the key the real read uses. */
export function SeedSkipped({ rows }: { rows: SkippedReviewRow[] }) {
  const client = useQueryClient();
  useState(() => {
    client.setQueryData(skippedReviewQueryKey("off"), rows);
    return true;
  });
  return null;
}

export const periodMonths: NonNullable<ProfitMonths> = {
  basis: "invoiced",
  from: "2026-05-01",
  to: "2026-10-08",
  project_id: "p-a",
  after_overhead: false,
  months: [
    { month: "2026-10", from: "2026-10-01", to: "2026-10-08", open: true, by_currency: [{ currency: "ILS", income_minor: 0n, expense_minor: 980_000n, profit_minor: -980_000n }] },
    { month: "2026-09", from: "2026-09-01", to: "2026-09-30", open: false, by_currency: [{ currency: "ILS", income_minor: 0n, expense_minor: 1_420_000n, profit_minor: -1_420_000n }] },
    { month: "2026-08", from: "2026-08-01", to: "2026-08-31", open: false, by_currency: [{ currency: "ILS", income_minor: 18_600_000n, expense_minor: 6_140_000n, profit_minor: 12_460_000n }] },
    { month: "2026-07", from: "2026-07-01", to: "2026-07-31", open: false, by_currency: [{ currency: "ILS", income_minor: 0n, expense_minor: 5_830_000n, profit_minor: -5_830_000n }] },
    { month: "2026-06", from: "2026-06-01", to: "2026-06-30", open: false, by_currency: [{ currency: "ILS", income_minor: 18_000_000n, expense_minor: 7_160_000n, profit_minor: 10_840_000n }] },
    { month: "2026-05", from: "2026-05-01", to: "2026-05-31", open: false, by_currency: [{ currency: "ILS", income_minor: 0n, expense_minor: 4_890_000n, profit_minor: -4_890_000n }] },
  ],
  by_currency: [{ currency: "ILS", income_minor: 36_600_000n, expense_minor: 26_420_000n, profit_minor: 10_180_000n }],
};
