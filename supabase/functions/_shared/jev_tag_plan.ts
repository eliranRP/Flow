// Tagging job: the types, limits and the pure planning of each line's questions and pre-fill.
// Split out of jev_tag.ts (FLOW-807). Decisions 0084 and 0124.

import { JEV_MODEL, type JevCall, type JevQuestion, type JevResult, type JevState, type JsonValue } from "./jev.ts";

export const JEV_TAG_DEFAULT_LIMIT = 50;
export const JEV_TAG_MAX_LIMIT = 100;
export const JEV_TAG_ATTEMPTS = 2;
export const JEV_TAG_BUDGET_MS = 120_000;
/** Do not start another Jev call when less than this much of the budget is left. */
export const JEV_TAG_RESERVE_MS = 20_000;
export const JEV_TAG_INTERVAL_MS = 60_000;
/** This many provider failures in a row end the run, so an outage marks few lines. */
export const JEV_TAG_OUTAGE_STOP = 3;
export const TRANSPORT_CODES = new Set(["rate_limited", "overloaded", "timeout", "unavailable"]);
/** The run lease outlives the 150 second Edge limit, so a killed run frees it on its own. */
export const JEV_TAG_LEASE_SECONDS = 180;
const CHOICE_CAP = 255;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TagMode = "shadow" | "auto";

export type TagProject = {
  id: string;
  name: string;
  /** A finished project: offered only on lines dated on or before its last line (decision 0139). */
  finished?: boolean;
  lastDocDate?: string | null;
  /** The company's overhead project (decision 0101). */
  overhead?: boolean;
};

/** The project answer for "no project": overhead, or not one project (decision 0139). Never pre-filled. */
export const JEV_NO_PROJECT = "none";
export type TagCategory = { id: string; name: string };

export type TagExpense = {
  id: string;
  companyId: string;
  description: string;
  docDate: string;
  /** Expense when absent. Income lines are sent too (decision 0134). */
  direction?: TagDirection;
  /** The party's name and id: the supplier on an expense, the customer on income. */
  supplierName: string | null;
  supplierId?: string | null;
  /** SQL anomaly flags on this line (decision 0131). The same call asks Jev to score them. */
  flags?: TagFlag[];
  /** How the owner filed this supplier before, newest first (decision 0127). */
  history?: TagFiling[];
  amountGross: number;
  amountNet: number;
  vatAmount: number;
  projectId: string | null;
  categoryId: string | null;
  projectAssigned: boolean;
  categoryAssigned: boolean;
  userAssigned: boolean;
  pnlRole: string | null;
  allocationCount: number;
  /** The line's source (the provider that synced it). */
  source?: string | null;
  /** The paying card's last 4, when the bank sent one. */
  cardLast4?: string | null;
  /** The nickname the owner gave that card in the bank (FLOW-707), often a property or a purpose. */
  cardName?: string | null;
};

export type TagDirection = "expense" | "income";

/** One SQL flag: its kind and the numbers behind it, as SQL returned them. */
export type TagFlag = { kind: string; detail: Record<string, JsonValue> };

/** A line the owner filed (approved or changed), from SQL. */
export type TagFiling = {
  docDate: string;
  description: string;
  amountNet: number;
  projectId: string | null;
  categoryId: string | null;
  pnlRole: string | null;
  split: boolean;
  /** Expense when absent. */
  direction?: TagDirection;
  /** What Jev suggested on that line, and whether the owner changed it (decision 0139). */
  jevProjectId?: string | null;
  jevCategoryId?: string | null;
  jevCorrected?: boolean;
};

/** Filed lines per supplier that go into a request. */
export const JEV_HISTORY_PER_SUPPLIER = 5;

export type TagCompanyWork = {
  companyId: string;
  mode: TagMode;
  threshold: number;
  projects: TagProject[];
  categories: TagCategory[];
  /** Income categories, offered on income lines. */
  incomeCategories?: TagCategory[];
  expenses: TagExpense[];
};

export type SuggestionRow = {
  companyId: string;
  transactionId: string;
  answers: Record<string, unknown>;
  confidence: number;
  modelVersion: string;
  responseModel: string;
};

export type PrefillWrite = {
  companyId: string;
  transactionId: string;
  projectId?: string;
  categoryId?: string;
  modelVersion: string;
  confidence: number;
};

export type TagPlan = {
  confidence: number;
  answers: Record<string, unknown>;
  write: PrefillWrite | null;
};

export class StoreConflict extends Error {
  constructor() {
    super("conflict");
    this.name = "StoreConflict";
  }
}

export class TagStop extends Error {
  readonly code: "unauthorized" | "missing_key";
  constructor(code: "unauthorized" | "missing_key") {
    super(code);
    this.name = "TagStop";
    this.code = code;
  }
}

export type CompanyUsage = {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  tagged: number;
  failed: number;
};

export type TagStore = {
  listWork(limit: number, companyId?: string | null): Promise<TagCompanyWork[]>;
  saveSuggestion(row: SuggestionRow): Promise<void>;
  /** False when SQL wrote nothing because the line closed or the owner set the field. */
  prefill(write: PrefillWrite): Promise<boolean | void>;
  deleteSuggestion(transactionId: string, modelVersion: string): Promise<void>;
  /** A line Jev failed on. The job does not send it again until its retry time. */
  markFailed(companyId: string, transactionId: string, modelVersion: string): Promise<void>;
};

export type TagJobStore = {
  takeLease(runId: string, seconds: number): Promise<boolean>;
  releaseLease(runId: string): Promise<void>;
  /** Calls granted from today's cap, at most `want`. */
  reserveCalls(companyId: string, runId: string, want: number): Promise<number>;
  finishUsage(companyId: string, runId: string, usage: CompanyUsage): Promise<void>;
};

export type TagCaller = (apiKey: string, input: JevCall) => Promise<JevResult>;

export type TagReport = {
  companies: number;
  tagged: number;
  prefilled: number;
  skipped: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  budget_skipped: number;
  cap_skipped: number;
};

export type TagRunOptions = {
  now?: () => number;
  budgetMs?: number;
  reserveMs?: number;
  log?: (line: string) => void;
  /** Filled per company: calls made, tokens, tagged and failed lines. */
  usage?: Map<string, CompanyUsage>;
};

export type JsonObject = { [key: string]: unknown };

export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function choiceCriteria(
  rows: readonly { id: string; name: string }[],
  cap = CHOICE_CAP,
): Record<string, string> | null {
  const usable = rows.filter((row) => row.id.trim() !== "" && row.name.trim() !== "");
  if (usable.length === 0 || usable.length > cap) return null;
  const criteria: Record<string, string> = {};
  for (const row of usable) criteria[row.id] = row.name;
  return criteria;
}

/** Said once per question when the line's card has a nickname (FLOW-707). */
export const CARD_NAME_HINT =
  "card_name in the state is the name the owner gave the paying card in the bank, often a property or a purpose; weigh it.";

export function buildTagQuestions(
  projects: readonly TagProject[],
  categories: readonly TagCategory[],
  direction: TagDirection = "expense",
  flagged = false,
  cardNamed = false,
): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {};
  const line = direction === "income" ? "income line" : "expense";
  // FLOW-707: only lines with a named card say so, so other lines ask exactly as before.
  const cardHint = cardNamed ? ` ${CARD_NAME_HINT}` : "";
  const projectCriteria = choiceCriteria(projects.map((project) => ({
    id: project.id,
    name: project.overhead
      ? `${project.name} (company overhead)`
      : project.finished
      ? `${project.name} (finished)`
      : project.name,
  })), CHOICE_CAP - 1); // One option is kept for none: Jev takes at most CHOICE_CAP.
  if (projectCriteria) {
    projectCriteria[JEV_NO_PROJECT] = "No project: overhead, or not tied to one project.";
    questions.project = {
      type: "choice",
      instructions: `Choose the project id for this ${line}.${cardHint}`,
      criteria: projectCriteria,
    };
  }
  const categoryCriteria = choiceCriteria(categories);
  if (categoryCriteria) {
    questions.category = {
      type: "choice",
      instructions: `Choose the ${direction} category id for this ${line}.${cardHint}`,
      criteria: categoryCriteria,
    };
  }
  // Only with a project or category question: a flagged line alone does not spend a call.
  if (flagged && Object.keys(questions).length > 0) {
    questions.anomaly = {
      type: "noul",
      instructions:
        "A check flagged this line (see flags in the state). Is it a real problem the owner should look at before approving?",
      criteria: {
        true: "A real problem: a double charge, a wrong amount, or a line that does not belong here.",
        false: "An ordinary line that the check flagged by chance.",
      },
    };
  }
  return questions;
}

export function lineDirection(expense: TagExpense): TagDirection {
  return expense.direction === "income" ? "income" : "expense";
}

/** The questions for one line: income lines get the income categories. */
export function lineQuestions(expense: TagExpense, company: TagCompanyWork): Record<string, JevQuestion> {
  const direction = lineDirection(expense);
  return buildTagQuestions(
    skipsProjectQuestion(expense) ? [] : lineProjects(expense, company),
    lineCategories(expense, company),
    direction,
    (expense.flags ?? []).length > 0,
    Boolean(expense.cardName),
  );
}

/** Active projects, and finished ones whose last line is not older than this line. */
export function lineProjects(expense: TagExpense, company: Pick<TagCompanyWork, "projects">): TagProject[] {
  return company.projects.filter((project) =>
    !project.finished || (project.lastDocDate != null && expense.docDate <= project.lastDocDate)
  );
}

export function lineCategories(expense: TagExpense, company: TagCompanyWork): TagCategory[] {
  return lineDirection(expense) === "income" ? company.incomeCategories ?? [] : company.categories;
}

/**
 * Amounts are context for the model. planTag does not write them back.
 * `past_filings` is how the owner filed the same supplier before, with the same ids the
 * questions offer; an archived project or hidden category comes through as a name of null.
 */
export function buildTagState(
  expense: TagExpense,
  projects: readonly TagProject[],
  categories: readonly TagCategory[],
): JevState {
  const direction = lineDirection(expense);
  const state: Record<string, JsonValue> = {
    description: expense.description,
    doc_date: expense.docDate,
    direction,
    [direction === "income" ? "customer" : "supplier"]: expense.supplierName,
    amount_gross: expense.amountGross,
    amount_net: expense.amountNet,
    vat_amount: expense.vatAmount,
  };
  // The owner names cards by property or purpose ("<property> Utilities"): a strong project hint.
  if (expense.cardName) state.card_name = expense.cardName;
  const flags = expense.flags ?? [];
  if (flags.length > 0) {
    state.flags = flags.map((flag) => ({ kind: flag.kind, ...flag.detail }));
  }
  const history = expense.history ?? [];
  if (history.length > 0) {
    const projectNames = new Map(projects.map((row) => [row.id, row.name]));
    const categoryNames = new Map(categories.map((row) => [row.id, row.name]));
    state.past_filings = history.slice(0, JEV_HISTORY_PER_SUPPLIER).map((filing) => {
      const entry: Record<string, JsonValue> = {
        doc_date: filing.docDate,
        description: filing.description,
        amount_net: filing.amountNet,
        project_id: filing.projectId,
        project_name: filing.projectId ? projectNames.get(filing.projectId) ?? null : null,
        category_id: filing.categoryId,
        category_name: filing.categoryId ? categoryNames.get(filing.categoryId) ?? null : null,
        pnl_role: filing.pnlRole,
        split: filing.split,
      };
      // Jev's own earlier guess on this line, and whether the owner corrected it (decision 0139).
      if (filing.jevProjectId || filing.jevCategoryId) {
        entry.jev_suggested_project_id = filing.jevProjectId ?? null;
        entry.jev_suggested_category_id = filing.jevCategoryId ?? null;
        entry.owner_corrected_jev = filing.jevCorrected === true;
      }
      return entry;
    });
  }
  return state;
}

function readChoice(value: unknown, allowed: ReadonlySet<string>): { id: string; confidence: number } | null {
  if (!isObject(value)) return null;
  const choice = value.choice;
  const confidence = value.confidence;
  if (typeof choice !== "string" || !allowed.has(choice)) return null;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return { id: choice, confidence };
}

function projectBlocked(expense: TagExpense): boolean {
  return expense.userAssigned
    || expense.projectAssigned
    || skipsProjectQuestion(expense);
}

/** Auto never writes one project on these lines, so the job does not ask for one. */
function skipsProjectQuestion(expense: TagExpense): boolean {
  return expense.pnlRole === "shared"
    || expense.pnlRole === "overhead"
    || expense.allocationCount > 1;
}

function withoutProject(answers: Record<string, unknown>): Record<string, unknown> {
  if (!("project" in answers)) return answers;
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (key !== "project") rest[key] = value;
  }
  return rest;
}

export function planTag(
  expense: TagExpense,
  mode: TagMode,
  threshold: number,
  projects: readonly TagProject[],
  categories: readonly TagCategory[],
  answers: Record<string, unknown>,
): TagPlan {
  const askProject = !skipsProjectQuestion(expense);
  const questions = buildTagQuestions(askProject ? projects : [], categories, lineDirection(expense));
  const parts: number[] = [];
  const projectAllowed = new Set([...projects.map((row) => row.id), JEV_NO_PROJECT]);
  const categoryAllowed = new Set(categories.map((row) => row.id));
  const project = "project" in questions ? readChoice(answers.project, projectAllowed) : undefined;
  const category = "category" in questions ? readChoice(answers.category, categoryAllowed) : undefined;
  if (project !== undefined) parts.push(project?.confidence ?? 0);
  if (category !== undefined) parts.push(category?.confidence ?? 0);
  const confidence = parts.length === 0 ? 0 : Math.min(...parts);
  // Auto pre-fills expenses and income alike (decision 0145). SQL writes the allocation for an
  // expense from the line's own amount, writes none for income, and holds back a line it flags.
  const gate = mode === "auto" && parts.length > 0 && confidence >= threshold;

  const write: PrefillWrite = {
    companyId: expense.companyId,
    transactionId: expense.id,
    modelVersion: JEV_MODEL,
    confidence,
  };
  if (gate && project && project.id !== JEV_NO_PROJECT && !projectBlocked(expense)) {
    write.projectId = project.id;
  }
  if (gate && category && !expense.userAssigned && !expense.categoryAssigned) {
    write.categoryId = category.id;
  }
  const hasWrite = write.projectId !== undefined || write.categoryId !== undefined;
  return { confidence, answers: askProject ? answers : withoutProject(answers), write: hasWrite ? write : null };
}

/** Non-finite, missing, and values below 1 use the default. Above the hard max clamps to it. */
export function clampTagLimit(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
    ? Number(value)
    : Number.NaN;
  if (!Number.isFinite(parsed)) return JEV_TAG_DEFAULT_LIMIT;
  const whole = Math.floor(parsed);
  if (whole < 1) return JEV_TAG_DEFAULT_LIMIT;
  return Math.min(JEV_TAG_MAX_LIMIT, whole);
}

/**
 * Equal shares of the cap, in the order of `companyIds`.
 * The first `cap % n` companies get one extra. The shares sum to the clamped cap.
 * The caller passes company ids in ascending order.
 */
export function companyQuotas(companyIds: readonly string[], cap: number): number[] {
  const limit = clampTagLimit(cap);
  const count = companyIds.length;
  if (count === 0) return [];
  const base = Math.floor(limit / count);
  const extra = limit % count;
  return companyIds.map((_, index) => base + (index < extra ? 1 : 0));
}

/** Newest doc_date, then id, then the clamped cap. The SQL query uses the same order and limit. */
export function capNewest(expenses: readonly TagExpense[], limit: number): TagExpense[] {
  const cap = clampTagLimit(limit);
  return expenses
    .slice()
    .sort((left, right) => right.docDate.localeCompare(left.docDate) || right.id.localeCompare(left.id))
    .slice(0, cap);
}
