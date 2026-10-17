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

/** The two bars' amounts on the card: הכנסות first, then הוצאות שנספרות ברווח. */
function cardFigures(): { income: bigint; expense: bigint } {
  const rows = [...document.querySelectorAll(".ui-cp-card .ui-cp-bar-top")];
  return { income: minorOf(rows[0]?.lastElementChild?.textContent), expense: minorOf(rows[1]?.lastElementChild?.textContent) };
}

describe("CompanyProfitScreen (FLOW-140c1)", () => {
  it("project rows add up to the head profit", () => {
    renderPage();
    const rows = [...document.querySelectorAll(".ui-cp-list .ui-cp-row")];
    expect(rows.length).toBeGreaterThan(1);
    const sum = rows.reduce((total, row) => total + rowAmount(row), 0n);
    expect(sum).toBe(headProfit());
  });

  it("category rows match the card: income and expense are the two sums", () => {
    renderPage(COMPANY_PROFIT_SAMPLE, "/profit?by=category");
    const rows = [...document.querySelectorAll(".ui-cp-list .ui-cp-row")];
    const amounts = rows.map(rowAmount);
    const income = amounts.filter((amount) => amount > 0n).reduce((total, amount) => total + amount, 0n);
    const expense = amounts.filter((amount) => amount < 0n).reduce((total, amount) => total - amount, 0n);
    const card = cardFigures();
    expect(card.income).toBe(income);
    expect(card.expense).toBe(expense);
    expect(income - expense).toBe(headProfit());
  });

  it("shows a loss with the minus sign and the loss colour", () => {
    renderPage();
    expect(headProfit()).toBeLessThan(0n);
    const figure = document.querySelector(".ui-cp-figure");
    expect(figure?.textContent).toContain(MINUS);
    expect(figure?.querySelector(".ui-loss")).not.toBeNull();
  });

  it("opens a category on one tap and closes it on the next", () => {
    renderPage(COMPANY_PROFIT_SAMPLE, "/profit?by=category");
    const row = document.querySelector(".ui-cp-list .ui-cp-row button") as HTMLButtonElement;
    expect(row).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(row.parentElement?.querySelectorAll(".ui-cp-lines .ui-row").length ?? 0).toBeGreaterThan(0);
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(row.parentElement?.querySelector(".ui-cp-lines")).toBeNull();
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
    expect(document.querySelector(".ui-cp-list .ui-cp-row button")).not.toBeNull();
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
});
