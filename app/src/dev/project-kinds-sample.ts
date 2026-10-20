import type { ProjectCashRow, ProjectDetail } from "@flow/shared";
import type { InvestmentFigures } from "../ui/investment-card";
import type { ProjectInvestment } from "../screens/project-investment-data";
import { shiftMonthKey } from "../period";
import { cash as flipCash, cashRow, months, project as flipProject, thisMonth } from "./project-cash-sample";
import { kindNextSample } from "./project-kinds-next-sample";

/**
 * The project page's other kinds, for the proof build and stories (`/e2e/project-detail?kind=`): a rental,
 * a client job and a brand-new project, in dollars, each with its next-month forecast, with invented names and round figures in the shape of
 * the board's frames.
 */

type Project = NonNullable<ProjectDetail>;
export type ProjectKind = "flip" | "rental" | "client" | "new";

const noInvestment: ProjectInvestment = { isOverhead: false, figures: null, categories: [], loans: [] };

const rentalProject: Project = {
  ...flipProject,
  id: "p-rental",
  name: "דירת הגפן 3",
  state_label: "השכרה • מושכר",
  budget_agorot: null,
  direct_agorot: 250_640n,
  by_currency: [{ currency: "USD", income_minor: 630_200n, direct_minor: 250_640n, shared_minor: 0n, profit_minor: 2_148_000n }],
  pending_count: 2,
  pending_agorot: 40_000n,
  transactions: [],
  loans: [{ id: "l-rental", name: "משכנתא לדוגמה", currency: "USD", balance_minor: 12_840_000n, status: "open" }],
};
const rentalFigures: InvestmentFigures = {
  currency: "USD",
  purchaseMinor: 16_000_000n,
  arvMinor: null,
  valueMinor: 21_500_000n,
  valueDate: "2026-10-01",
  rehabMinor: 1_200_000n,
  rehabOther: [],
  loanMinor: 12_840_000n,
  loanOther: [],
  forcedEquityMinor: null,
  currentEquityMinor: 8_660_000n,
};
// The board's Cedar St months, newest first: October to date, then September back to May.
const rentalCash = months([
  [cashRow(630_200n, 250_640n, 379_560n)],
  [cashRow(415_000n, 174_000n, 241_000n)],
  [cashRow(415_000n, 176_000n, 239_000n)],
  [cashRow(415_000n, 170_000n, 245_000n)],
  [cashRow(415_000n, 187_000n, 228_000n)],
  [cashRow(415_000n, 180_000n, 235_000n)],
]);

const clientProject: Project = {
  ...flipProject,
  id: "p-client",
  name: "גג משפחת דגן",
  state_label: "עבודת לקוח • תשלום 2 מתוך 4",
  budget_agorot: 4_200_000n,
  direct_agorot: 2_360_000n,
  by_currency: [{ currency: "USD", income_minor: 3_200_000n, direct_minor: 2_220_000n, shared_minor: 0n, profit_minor: 980_000n }],
  pending_count: 0,
  pending_agorot: 0n,
  transactions: [],
  loans: [],
};
const clientCash = months([
  [cashRow(1_500_000n, 0n, 1_500_000n)],
  [cashRow(0n, 2_160_000n, -2_160_000n)],
  [cashRow(1_640_000n, 0n, 1_640_000n)],
]);

const newProject: Project = {
  ...flipProject,
  id: "p-new",
  name: "קיר תמך חדש",
  state_label: "flip • חדש",
  budget_agorot: 9_000_000n,
  direct_agorot: 0n,
  by_currency: [],
  pending_count: 0,
  pending_agorot: 0n,
  transactions: [],
  loans: [],
};
const newCash = months([[cashRow(0n, 0n, 0n)]]);

type Kind = { project: Project; cash: typeof flipCash; investment: ProjectInvestment; first: string | null };

const kinds: Record<Exclude<ProjectKind, "flip">, Kind> = {
  rental: { project: rentalProject, cash: rentalCash, investment: { isOverhead: false, figures: rentalFigures, categories: [], loans: [] }, first: "2025-03-01" },
  // The client job began with its oldest cash month, two before this one.
  client: { project: clientProject, cash: clientCash, investment: noInvestment, first: `${shiftMonthKey(thisMonth, -2)}-01` },
  new: { project: newProject, cash: newCash, investment: noInvestment, first: null },
};

export function kindOf(value: string | null): Exclude<ProjectKind, "flip"> | null {
  return value === "rental" || value === "client" || value === "new" ? value : null;
}

/** The kind's page data and its row on the Projects list (the month it began, its type). */
export function kindSample(kind: Exclude<ProjectKind, "flip">, base: ProjectCashRow | undefined) {
  const sample = kinds[kind];
  const row = base == null ? undefined : { ...base, id: sample.project.id, first_month: sample.first, pending_count: sample.project.pending_count ?? 0, deletable: false };
  const next = kind === "new" ? undefined : kindNextSample(kind, sample.project.id);
  return { ...sample, row, next };
}
