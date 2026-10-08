import { formatAmountText } from "@flow/shared";
import { percentText, type PayloadPart, type ServerPart } from "../line-split";

/** What every split write refreshes: the parts, the line, and every P&L figure. */
export const LINE_SPLIT_KEYS = ["line-split", "txn", "dashboard", "project", "project-category", "home", "breakdown", "breakdown-lines", "review"];

/** 49 parts plus the rest: the server takes 50 (plan §2). */
export const LINE_SPLIT_MAX_PARTS = 49;

const PICK_LINE_PROJECT = "פרויקט השורה";

/** The line as the editor needs it. */
export type LineInfo = {
  id: string;
  /** Signed, as stored. */
  amountNet: bigint;
  direction: "income" | "expense";
  currency: string;
  categoryId: string | null;
  categoryName: string | null;
  projectId: string | null;
  projectName: string | null;
  supplier: string;
  docDate: string;
  /** An open review other than `split_mismatch` refuses the save (0125). */
  reviewBlocked: boolean;
  /** That open review's id, when known: לתור opens its card. */
  reviewId?: string | null;
  /** A loan split refuses a split by category (0104). */
  loanSplit: boolean;
  /** `in_pnl_override` true: the line's kept-out parts count, so a reversal part needs a project (0138). */
  inPnl?: boolean;
};

/** The server calls the editor makes. Stories and tests pass their own. */
export type LineSplitApi = {
  preview: (parts: PayloadPart[]) => Promise<ServerPart[]>;
  save: (parts: PayloadPart[]) => Promise<void>;
};

export function money(minor: bigint, currency: string): string {
  return formatAmountText(minor, currency, { detail: true });
}

export function Amount({ minor, currency, className }: { minor: bigint; currency: string; className?: string }) {
  return <bdi className={className ? `ui-num ${className}` : "ui-num"} dir="ltr">{money(minor, currency)}</bdi>;
}

export function Percent({ value }: { value: number }) {
  return <bdi className="ui-num" dir="ltr">{`${percentText(value)}%`}</bdi>;
}

export function partProjectLabel(projectName: string | null | undefined, lineProject: string | null): string {
  if (projectName) return projectName;
  return lineProject ? `${lineProject} · ${PICK_LINE_PROJECT}` : "בלי פרויקט";
}
