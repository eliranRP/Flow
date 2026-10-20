import { type ExpectedMonths, monthIndex, type ProjectCategoryMonths } from "@flow/shared";
import { shiftMonthKey } from "../period";
import { nextMonthKey } from "../project-next-month";
import type { NextMonthSample } from "../project-next-month-query";
import { israelToday } from "../ui/date-math";
import { JUNIPER_NEXT } from "./project-next-month-sample";

/**
 * The project page's next-month forecast by kind (Projects board, spec-fcwide), on the same dates as the
 * kinds' cash months (they run from today): invented names and round figures in the shape of the board's
 * frames. The rental is the profit page's sample moved to this month (rent 4,150 in, 1,865 out); the flip
 * expects no income and its renovation average (13,000 and 11,000 over two months: 12,000); the client job
 * has the two lines the owner added for next month (the client's 12,500 payment and the subcontractor's 4,200).
 */

type Kind = "flip" | "rental" | "client";

const today = israelToday();
const thisMonth = today.slice(0, 7);
const nextMonth = nextMonthKey(today);

/** A month key of the profit page's sample, moved by the months between its today and ours. */
function moved(key: string): string {
  return shiftMonthKey(key, monthIndex(thisMonth) - monthIndex(JUNIPER_NEXT.today.slice(0, 7)));
}

function rental(projectId: string): NextMonthSample {
  const base = JUNIPER_NEXT;
  const months = base.categoryMonths as ProjectCategoryMonths;
  return {
    ...base,
    today,
    expected: {
      ...base.expected,
      today,
      project_id: projectId,
      months: base.expected.months.map((month) => ({ ...month, month: moved(month.month) })),
      recurring: base.expected.recurring.map((party) => ({
        ...party,
        project_id: projectId,
        next_due_month: party.next_due_month == null ? null : moved(party.next_due_month),
      })),
    },
    categoryMonths: { ...months, project_id: projectId, today, this_month: `${thisMonth}-01`, months: months.months.map((month) => `${moved(month.slice(0, 7))}-01`) },
  };
}

function quiet(projectId: string): ExpectedMonths {
  return {
    today,
    project_id: projectId,
    months: [{ month: thisMonth, open: true, by_currency: [] }, { month: nextMonth, open: false, by_currency: [] }],
    recurring: [],
  };
}

/** The six full months before this one, oldest first, as project_category_months lists them. */
const windowMonths = Array.from({ length: 6 }, (_, index) => `${shiftMonthKey(thisMonth, index - 6)}-01`);

function flip(projectId: string): NextMonthSample {
  return {
    today,
    expected: quiet(projectId),
    categoryMonths: {
      project_id: projectId,
      today,
      this_month: `${thisMonth}-01`,
      months: windowMonths,
      categories: [{
        id: "c-5", name: "חומרים", group_name: null, currency: "USD", this_month_minor: 0, months_minor: [0, 0, 0, 0, 1_300_000, 1_100_000],
        months_seen: 2, expected_minor: null, typical_day: null, flag: null,
      }],
    },
    categories: JUNIPER_NEXT.categories,
  };
}

function client(projectId: string): NextMonthSample {
  const added = (id: string, direction: "income" | "expense", name: string, categoryId: string, amount: number) => ({
    id, kind: "add" as const, row_key: null, category_id: categoryId, category_name: name, direction, amount_minor: amount, pace: "once" as const, start_month: nextMonth,
  });
  return {
    today,
    expected: quiet(projectId),
    categoryMonths: null,
    edits: [added("e-client", "income", "תשלום מהלקוח", "other-income", 1_250_000), added("e-sub", "expense", "קבלני משנה", "c-11", 420_000)],
    categories: JUNIPER_NEXT.categories,
  };
}

/** The kind's next-month reads, for the project with this id. */
export function kindNextSample(kind: Kind, projectId: string): NextMonthSample {
  if (kind === "rental") return rental(projectId);
  return kind === "flip" ? flip(projectId) : client(projectId);
}
