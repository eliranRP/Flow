import { fireEvent, screen, within } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { COMPANY_PROFIT_SAMPLE } from "../dev/company-profit-sample";
import { renderWithProviders } from "../test-render";
import { CompanyProfitScreen, type CompanyProfitSample } from "./company-profit-screen";

const MINUS = "−";

/** A rendered amount as minor units: "−$1,234.50" reads −123450n. Whole dollars read as cents too. */
function minorOf(text: string | null | undefined): bigint {
  const value = (text ?? "").trim();
  const negative = value.startsWith(MINUS) || value.startsWith("-");
  const digits = value.replace(/[^\d.]/g, "");
  const [whole = "0", cents = ""] = digits.split(".");
  const minor = BigInt(whole || "0") * 100n + BigInt((cents + "00").slice(0, 2));
  return negative ? -minor : minor;
}

/** The page's query string, so a test can read what a chip wrote. */
function LocationProbe() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderPage(sample: CompanyProfitSample = COMPANY_PROFIT_SAMPLE, route = "/profit") {
  return renderWithProviders(
    <>
      <CompanyProfitScreen sample={sample} />
      <LocationProbe />
    </>,
    { route },
  );
}

/** The head figure: the big profit under the title. */
function headProfit(): bigint {
  const figure = document.querySelector(".ui-cp-figure");
  if (!(figure instanceof HTMLElement)) throw new Error("no head figure");
  return minorOf(figure.textContent);
}

/** The amount of a row: the last child of its name line. */
function rowAmount(row: Element): bigint {
  const top = row.querySelector(".ui-cp-top");
  if (!(top instanceof HTMLElement)) throw new Error("no amount line");
  return minorOf(top.lastElementChild?.textContent);
}

/** The summary card's rows: label and figure, in order. */
function summaryRows(): { label: string; minor: bigint; strong: boolean }[] {
  return [...document.querySelectorAll(".ui-cp-card .ui-pp-row")].map((row) => ({
    label: row.querySelector(".ui-pp-label")?.textContent ?? "",
    minor: minorOf(row.lastElementChild?.textContent),
    strong: row.classList.contains("ui-pp-row-strong"),
  }));
}

/** The card's הכנסות and הוצאות שנספרות ברווח rows. */
function cardFigures(): { income: bigint; expense: bigint } {
  const rows = summaryRows();
  return { income: rows[0]?.minor ?? 0n, expense: rows[1]?.minor ?? 0n };
}

describe("CompanyProfitScreen (FLOW-140c1)", () => {
  it("project rows add up to the head profit", () => {
    renderPage();
    const rows = [...document.querySelectorAll(".ui-cp-list .ui-cp-row")];
    expect(rows.length).toBeGreaterThan(1);
    const sum = rows.reduce((total, row) => total + rowAmount(row), 0n);
    expect(sum).toBe(headProfit());
  });

  it("the category view has income then expenses, each head's total matching the card", () => {
    renderPage(COMPANY_PROFIT_SAMPLE, "/profit?by=category");
    const heads = [...document.querySelectorAll(".ui-lines-group-head")];
    expect(heads.map((head) => head.querySelector(".ui-lines-group-title")?.textContent)).toEqual(["הכנסות", "הוצאות"]);
    const [income, expense] = heads.map((head) => minorOf(head.querySelector(".ui-lines-group-sum")?.textContent));
    expect(heads[0]?.querySelector(".ui-lines-group-sum")?.textContent).toMatch(/^\+/);
    const card = cardFigures();
    expect(income).toBe(card.income);
    expect(expense).toBe(card.expense);
    expect((income ?? 0n) - (expense ?? 0n)).toBe(headProfit());
  });

  it("each group's rows run largest first and add to its head, with shares, counts and projects only above one", () => {
    renderPage(COMPANY_PROFIT_SAMPLE, "/profit?by=category");
    const groups = [...document.querySelectorAll(".ui-lines-group")];
    expect(groups).toHaveLength(2);
    groups.forEach((group, index) => {
      const rows = [...group.querySelectorAll(".ui-pcat-button")];
      const amounts = rows.map((row) => minorOf(row.querySelector(".ui-pcat-top")?.lastElementChild?.textContent));
      expect(amounts.every((amount, at) => at === 0 || (amounts[at - 1] ?? 0n) >= amount)).toBe(true);
      expect(amounts.reduce((sum, amount) => sum + amount, 0n)).toBe(minorOf(group.querySelector(".ui-lines-group-sum")?.textContent));
      const word = index === 0 ? "מההכנסות" : "מההוצאות";
      for (const row of rows) expect(row.querySelector(".ui-pcat-meta")?.textContent).toMatch(new RegExp(`^\\d+% ${word} · (1 תנועה|\\d+ תנועות)`));
      expect(rows[0]?.querySelector<HTMLElement>(".ui-pcat-bar-fill")?.style.width).toBe("100%");
      expect(rows.every((row) => (row.querySelector(".ui-income") != null) === (index === 0))).toBe(true);
    });
    const metas = [...document.querySelectorAll(".ui-pcat-meta")].map((meta) => meta.textContent);
    expect(metas.some((text) => / · 2 פרויקטים$/.test(text))).toBe(true);
    expect(metas.some((text) => / · 1 תנועה$/.test(text))).toBe(true);
    for (const text of metas) {
      const match = /(\d+) פרויקטים/.exec(text);
      if (match) expect(Number(match[1])).toBeGreaterThan(1);
    }
  });

  it("shows a loss with the minus sign and the loss colour", () => {
    renderPage();
    expect(headProfit()).toBeLessThan(0n);
    const figure = document.querySelector(".ui-cp-figure");
    expect(figure?.textContent).toContain(MINUS);
    expect(figure?.querySelector(".ui-loss")).not.toBeNull();
  });

  it("opens a category in place to its lines with day and project, one at a time, and closes it on the next tap", () => {
    renderPage(COMPANY_PROFIT_SAMPLE, "/profit?by=category");
    const [first, second] = [...document.querySelectorAll<HTMLButtonElement>(".ui-pcat-button")];
    if (first == null || second == null) throw new Error("missing category rows");
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelectorAll(".ui-pcat .ui-row")).toHaveLength(0);
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded", "true");
    const lines = [...(first.parentElement?.querySelectorAll(".ui-row") ?? [])];
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]?.textContent).toMatch(/\d{2}\/\d{2} · /);
    fireEvent.click(second);
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(second).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelectorAll(".ui-pcat .ui-row")).toHaveLength(0);
  });

  it("the chips set ?by= and reorder the rows; the project order is the default", () => {
    renderPage();
    const search = () => screen.getByTestId("search").textContent;
    const group = screen.getAllByRole("group", { name: "סידור" })[0] as HTMLElement;
    // The default: projects, the largest amount (in or out) first.
    const sizes = [...document.querySelectorAll(".ui-cp-list .ui-cp-row")].map((row) => {
      const amount = rowAmount(row);
      return amount < 0n ? -amount : amount;
    });
    expect(sizes.every((size, index) => index === 0 || (sizes[index - 1] ?? 0n) >= size)).toBe(true);
    expect(search()).toBe("");
    fireEvent.click(within(group).getByRole("button", { name: "לפי קטגוריה" }));
    expect(search()).toBe("?by=category");
    expect(within(group).getByRole("button", { name: "לפי קטגוריה" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".ui-pcat-button")).not.toBeNull();
    fireEvent.click(within(group).getByRole("button", { name: "לפי סכום" }));
    expect(search()).toBe("?by=amount");
    expect(screen.getByRole("heading", { name: "מהגדול לקטן" })).toBeInTheDocument();
    fireEvent.click(within(group).getByRole("button", { name: "לפי פרויקט" }));
    expect(search()).toBe("");
    expect(within(group).getByRole("button", { name: "לפי פרויקט" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".ui-cp-list .ui-cp-row a")).not.toBeNull();
  });

  it("the basis line opens the basis sheet", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /נספר לפי תאריך תשלום · שינוי/ }));
    const dialog = await screen.findByRole("dialog", { name: "רווח ותזרים לפי" });
    expect(within(dialog).getByRole("radio", { name: /תאריך חשבונית/ })).toBeInTheDocument();
  });

  it("a project row links to the project's profit page, from this page", () => {
    renderPage();
    const link = document.querySelector('.ui-cp-list a[href^="/projects/"]');
    expect(link).toHaveAttribute("href", "/projects/p1/profit?from=profit");
  });

  it("a project holding a shared cost keeps its name and link; the general costs are one כללי row with no link", () => {
    renderPage();
    const list = document.querySelector(".ui-cp-list");
    if (!(list instanceof HTMLElement)) throw new Error("no project list");
    expect(within(list).getByText("וילה הברושים").closest("a")).toHaveAttribute("href", "/projects/p2/profit?from=profit");
    const general = within(list).getByText("כללי");
    expect(general.closest("a")).toBeNull();
    expect(general.closest(".ui-cp-row")?.querySelector(".ui-cp-meta")?.textContent).toBe("4 תנועות");
    expect(list.querySelectorAll(".ui-cp-row")).toHaveLength(6);
    expect(list.querySelector('a[href^="/projects/overhead"], a[href^="/projects/unassigned"]')).toBeNull();
    expect([...list.querySelectorAll(".ui-cp-name")].every((name) => name.textContent !== "")).toBe(true);
  });
});
