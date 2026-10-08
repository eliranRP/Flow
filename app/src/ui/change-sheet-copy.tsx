import { isTransientWriteError, type WriteFailure } from "../use-write";

export const CHANGE_SAVE_FAILURE = "לא נשמר – אין חיבור";

/** A refusal the database will repeat. Not a connection problem. Decision 0072. */
export const CHANGE_SAVE_REFUSAL = "לא נשמר. בדקו את הפרטים ונסו שוב.";

/** The database refuses one project on a shared cost. Say where the split happens. */
export const SHARED_SPLIT_FAILURE = "עלות משותפת מפוצלת במסך הפיצול.";

/** Decision 0076. The fourth split choice, and the note above the project picker. */
export const ONE_PROJECT_OPTION = "לפרויקט אחד";
export const ONE_PROJECT_DETAIL = "הסכום כולו עובר לפרויקט אחד";
export const COLLAPSE_SPLIT_NOTE = "הפיצול ירד, והסכום כולו יעבור לפרויקט הזה.";
export const COLLAPSE_PICK_HOLD = "בחרו פרויקט.";

export function changeSaveFailure(error: Error): WriteFailure {
  if (error.message.includes("shared costs are split")) {
    return { message: SHARED_SPLIT_FAILURE, retry: false, tone: "info", action: "לפיצול" };
  }
  if (isTransientWriteError(error)) return CHANGE_SAVE_FAILURE;
  return { message: CHANGE_SAVE_REFUSAL, retry: false };
}

export type ChangeChoice = {
  id: string;
  name: string;
  code?: string;
  /** Relative last use. Recent rows keep the order they are given. */
  recent?: string;
  status?: "active" | "finished";
  /** Hidden categories stay out of the picker. The current row can still show. */
  hidden?: boolean;
};
