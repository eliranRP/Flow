import { amountText, type LineSplitRead, type PartDraft, type PayloadPart, type RestDraft } from "./line-split";
import { sampleApi } from "./line-split-preview";
import { reviewerCategories, reviewerOtherProjectName, reviewerProjectName, reviewerSharedAgorot, reviewerSplitProjects } from "./reviewer-sample";
import type { LineSplitSample } from "./screens/line-split";

/**
 * The reviewer preview's split screens (FLOW-922): LineSplitScreen on invented lines. Prod-safe:
 * it imports nothing from dev. The reviewer keeps its own sample categories and projects.
 */

/** The six-way leasing split: ₪3,200 over six invented projects, by basis points. */
export const unsplitProjects = [
  { id: "p-alon", name: reviewerProjectName, bp: 1667 },
  { id: "p-raanana", name: reviewerOtherProjectName, bp: 1667 },
  { id: "p-north", name: "מגרש לדוגמה", bp: 1667 },
  { id: "p-south", name: "מחסן לדוגמה", bp: 1667 },
  { id: "p-east", name: "גג המזרח", bp: 1666 },
  { id: "p-west", name: "חניון המערב", bp: 1666 },
] as const;

export const unsplitNet = 320_000n;

export function unsplitShare(bp: number): bigint {
  return (unsplitNet * BigInt(bp)) / 10_000n;
}

type SplitSampleInput = {
  id: string;
  supplier: string;
  docDate: string;
  /** Agorot, positive: the expense's amount. */
  amount: bigint;
  categoryId: string;
  projects: { id: string; name: string }[];
  /** The line's own project: the rest's project when the parts leave it out. */
  lineProject?: { id: string; name: string };
  /** The saved split the editor opens on, when there is one (its clear link is then shown). */
  split?: LineSplitRead | null;
  parts?: PartDraft[];
  rest?: RestDraft;
  onSave: (parts: PayloadPart[]) => void | Promise<void>;
};

/** A sample expense for LineSplitScreen: the reviewer's categories, an api that checks like the server. */
function splitSample({ id, supplier, docDate, amount, categoryId, projects, lineProject, split, parts, rest, onSave }: SplitSampleInput): LineSplitSample {
  const category = reviewerCategories.find((entry) => entry.id === categoryId);
  const line = {
    id,
    amountNet: -amount,
    direction: "expense" as const,
    currency: "ILS",
    categoryId,
    categoryName: category?.name ?? null,
    projectId: lineProject?.id ?? null,
    projectName: lineProject?.name ?? null,
    supplier,
    docDate,
    reviewBlocked: false,
    loanSplit: false,
  };
  return {
    line,
    categories: reviewerCategories.map((entry) => ({ ...entry, kind: "expense", hidden: false })),
    projects,
    split: split ?? null,
    parts,
    rest,
    api: sampleApi(line, () => false, onSave),
  };
}

/** The leasing line: the saved six-way split, the first project keeps the rest. */
export function leasingSplitSample(onSave: (parts: PayloadPart[]) => void | Promise<void>): LineSplitSample {
  const category = "c-haul";
  const split: LineSplitRead = {
    transactionId: "t-leasing",
    currency: "ILS",
    lineMinor: unsplitNet,
    partsMatch: true,
    parts: unsplitProjects.map((project, index) => ({
      category_id: category,
      category_name: reviewerCategories.find((entry) => entry.id === category)?.name ?? null,
      project_id: project.id,
      project_name: project.name,
      amount_minor: index === 0 ? unsplitNet - unsplitShare(unsplitProjects.slice(1).reduce((sum, other) => sum + other.bp, 0)) : unsplitShare(project.bp),
      percent: null,
      rest: index === 0,
    })),
  };
  return splitSample({
    id: "t-leasing",
    supplier: "ליסינג הדרך בע״מ",
    docDate: "2026-07-01",
    amount: unsplitNet,
    categoryId: category,
    lineProject: unsplitProjects[0],
    projects: unsplitProjects.map((project) => ({ id: project.id, name: project.name })),
    split,
    parts: unsplitProjects.slice(1).map((project, index): PartDraft => ({
      key: `leasing-${String(index + 1)}`,
      categoryId: category,
      projectId: project.id,
      unit: "amount",
      value: amountText(unsplitShare(project.bp)),
    })),
    rest: { categoryId: category, projectId: unsplitProjects[0].id },
    onSave,
  });
}

/** The shared line: no parts, and the rest has no project until one is picked. */
export function sharedSplitSample(onSave: (parts: PayloadPart[]) => void | Promise<void>): LineSplitSample {
  return splitSample({
    id: "t-shared",
    supplier: "עגורני החוף בע״מ",
    docDate: "2026-09-29",
    amount: reviewerSharedAgorot,
    categoryId: "c-materials",
    projects: reviewerSplitProjects.map((project) => ({ id: project.id, name: project.name })),
    rest: { categoryId: null, projectId: null },
    onSave,
  });
}
