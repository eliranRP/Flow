import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JUNIPER_NEXT } from "../dev/project-next-month-sample";
import { JUNIPER_PROFIT } from "../dev/project-profit-sample";
import { ProjectNextMonthScreen } from "./project-next-month-screen";
import { ProjectProfitScreen, type ProjectProfitSample } from "./project-profit-screen";

// Lets one test stand for a project whose forecast has nothing to read; the others read the sample.
const noForecast = vi.hoisted(() => ({ on: false }));
vi.mock("../project-next-month-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../project-next-month-query")>();
  return {
    ...actual,
    useNextMonthForecast: (...args: Parameters<typeof actual.useNextMonthForecast>) => {
      const result = actual.useNextMonthForecast(...args);
      return noForecast.on ? { ...result, forecast: null } : result;
    },
  };
});

afterEach(() => {
  noForecast.on = false;
});

function renderProfit(sample: ProjectProfitSample, path = "/projects/juniper-ct/profit") {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects/:projectId/profit" element={<ProjectProfitScreen sample={sample} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderNext() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/projects/juniper-ct/profit/next"]}>
        <Routes>
          <Route path="/projects/:projectId/profit/next" element={<ProjectNextMonthScreen sample={{ ...JUNIPER_PROFIT, next: JUNIPER_NEXT }} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the next-month card on the project's profit page", () => {
  it("shows November's net, its totals and basis, and links to the next-month page", () => {
    renderProfit(JUNIPER_PROFIT);
    const card = screen.getByRole("link", { name: /^צפי נובמבר/ });
    expect(card.getAttribute("href")).toBe("/projects/juniper-ct/profit/next");
    expect(card.textContent).toContain("+$2,380");
    expect(within(card).getByText("הכנסות $4,150 · הוצאות $1,770")).toBeTruthy();
    expect(within(card).getByText("2 קבועים וממוצע 3 קטגוריות")).toBeTruthy();
    expect(within(card).getByText("צפי")).toBeTruthy();
  });

  it("says a loss once, with the amount after the word", () => {
    const loss = { ...JUNIPER_NEXT, expected: { ...JUNIPER_NEXT.expected, recurring: JUNIPER_NEXT.expected.recurring.filter((party) => party.direction === "expense") } };
    renderProfit({ ...JUNIPER_PROFIT, next: loss });
    expect(screen.getByRole("link", { name: "צפי נובמבר, הפסד $1,770" })).toBeTruthy();
  });

  it("sits above the month rows", () => {
    const { container } = renderProfit(JUNIPER_PROFIT);
    const card = container.querySelector(".ui-pn-card");
    const months = container.querySelector(".ui-pp-months");
    expect(card).not.toBeNull();
    expect(months).not.toBeNull();
    expect(card?.compareDocumentPosition(months as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("is hidden when the project expects nothing next month", () => {
    const empty = { ...JUNIPER_NEXT, expected: { ...JUNIPER_NEXT.expected, recurring: [] }, categoryMonths: null };
    const { container } = renderProfit({ ...JUNIPER_PROFIT, next: empty });
    expect(container.querySelector(".ui-pn-card")).toBeNull();
    expect(container.querySelector(".ui-pp-months")).not.toBeNull();
  });

  it("is hidden in the by-category order", () => {
    const { container } = renderProfit(JUNIPER_PROFIT, "/projects/juniper-ct/profit?by=category");
    expect(container.querySelector(".ui-pn-card")).toBeNull();
  });
});

describe("ProjectNextMonthScreen", () => {
  it("names the month, the project and the count, with Back to the project's profit", () => {
    renderNext();
    expect(screen.getByRole("heading", { name: "צפי נובמבר" })).toBeTruthy();
    expect(screen.getByText("Juniper Ct · עוד לא התחיל · 5 צפויות")).toBeTruthy();
    expect(screen.getByRole("button", { name: "חזרה לרווח Juniper Ct" })).toBeTruthy();
  });

  it("adds the summary card up: expected income and expenses, the monthly share and the profit after it", () => {
    const { container } = renderNext();
    const rows = Array.from(container.querySelectorAll(".ui-pp-row")).map((row) => row.textContent);
    expect(rows).toEqual([
      "הכנסות צפויות+$4,150",
      "הוצאות צפויות$1,770",
      "חלק בהוצאות הכלליות$152",
      "רווח אחרי הוצאות כלליות$2,228",
    ]);
    expect(container.querySelector(".ui-pp-figure")?.textContent).toBe("+$2,380");
    expect(screen.getByText(/^לפי הקבועים של הנכס וממוצע שאר ההוצאות ב־6 החודשים האחרונים, בלי קרן הלוואות\./)).toBeTruthy();
  });

  it("lists the recurring rows by day and the average last, with no chips", () => {
    const { container } = renderNext();
    const rows = Array.from(container.querySelectorAll(".ui-pn-rows .ui-row"));
    expect(rows.map((row) => row.querySelector(".ui-row-title")?.textContent)).toEqual([
      "M. Ortiz",
      "S. Kim",
      "ריבית הלוואות",
      "תיקונים ותחזוקה",
      "מסים וביטוח",
    ]);
    expect(rows[0]?.textContent).toContain("צפוי 01/11 · קבוע");
    expect(rows[0]?.textContent).toContain("+$1,850");
    // The servicer's whole payment (principal included) is not a row: its interest and escrow are.
    expect(rows[2]?.textContent).toContain("ממוצע 6 חודשים");
    expect(rows[2]?.textContent).toContain("−$1,180");
    expect(rows[3]?.textContent).toContain("−$310");
    expect(rows[4]?.textContent).toContain("−$280");
    expect(screen.queryByText("Northgate Mortgage")).toBeNull();
    expect(screen.queryByRole("group", { name: "סידור" })).toBeNull();
    // A row is a line to read, not a control.
    expect(rows.every((row) => row.tagName === "DIV")).toBe(true);
  });

  it("says there is not enough to forecast when it has nothing to read", () => {
    noForecast.on = true;
    renderNext();
    expect(screen.getByRole("heading", { name: "צפי" })).toBeTruthy();
    expect(screen.getByText("אין עדיין מספיק נתונים לצפי")).toBeTruthy();
  });
});
