import { ExampleBar } from "../ui/screen-stories-support";
import { StoryRoute } from "../ui/story-route";
import { ReportLinesScreen } from "./report-lines-screen";

/** The reports drill-down's story fixtures and checks, shared by its stories (FLOW-161, FLOW-167, FLOW-170). */

export function line(id: string, date: string, dollars: number, project: string, supplier: string, description = supplier) {
  return {
    transaction_id: `b0000000-0000-4000-8000-00000000${id}`,
    part: null,
    description,
    supplier_name: supplier,
    project_name: project,
    category_name: "תיקונים ותחזוקה",
    doc_date: date,
    currency: "USD",
    amount_minor: BigInt(dollars * 100),
    shared: false,
  };
}

export const CATEGORY_ROWS = [
  line("0001", "2026-10-18", 1_250, "Cedar St", "Quick Fix Plumbing", "Water heater replacement, unit 2"),
  line("0002", "2026-10-09", 400, "Maple Ave", "Northside Hardware"),
  line("0003", "2026-09-22", 980, "Oak Ridge", "Bright Electric"),
  line("0004", "2026-09-11", 200, "Riverside Commons Phase Two Townhomes", "Northside Hardware"),
];

export function CategoryLinesView({ rows = CATEGORY_ROWS }: { rows?: ReturnType<typeof line>[] }) {
  return (
    <StoryRoute entry="/reports/lines?side=expense&category=c-repairs&name=%D7%AA%D7%99%D7%A7%D7%95%D7%A0%D7%99%D7%9D%20%D7%95%D7%AA%D7%97%D7%96%D7%95%D7%A7%D7%94&from=2026-01-01&to=2026-10-31&cur=USD" tabs>
      <ExampleBar />
      <ReportLinesScreen sample={{ rows, hasMore: true }} />
    </StoryRoute>
  );
}

/** Whether the text is drawn whole inside its row: not cut by an ellipsis, not on a hidden line. */
export function inView(element: Element, text: string): boolean {
  // The drawn text only: a snippet's whole description for screen readers is hidden (.sr-only).
  const node = [...element.querySelectorAll("*"), element]
    .filter((el) => el.closest(".sr-only") == null)
    .flatMap((el) => [...el.childNodes])
    .find((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.includes(text) === true);
  if (node?.textContent == null) return false;
  const range = document.createRange();
  const start = node.textContent.indexOf(text);
  range.setStart(node, start);
  range.setEnd(node, start + text.length);
  const word = range.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  const clipped = element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 1;
  return !clipped && word.width > 0 && word.left >= box.left - 1 && word.right <= box.right + 1 && word.top >= box.top - 1 && word.bottom <= box.bottom + 1;
}

/** The title's drawn lines: its height over its line height. */
export function titleLines(title: Element): number {
  const line = Number.parseFloat(getComputedStyle(title).lineHeight);
  return Math.round(title.getBoundingClientRect().height / line);
}
