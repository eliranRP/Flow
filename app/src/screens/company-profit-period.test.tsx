import { fireEvent, screen, within } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { COMPANY_PROFIT_SAMPLE } from "../dev/company-profit-sample";
import { renderWithProviders } from "../test-render";
import { CompanyProfitScreen } from "./company-profit-screen";

/**
 * FLOW-145 (canvas note spec-years): the company profit page's period switch, אוקטובר | 2026 | מההתחלה, turns
 * everything under it to the year or since the start, and keeps its choice in the URL while the page is open.
 */

function LocationProbe() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderPage(route = "/profit") {
  return renderWithProviders(
    <>
      <CompanyProfitScreen sample={COMPANY_PROFIT_SAMPLE} />
      <LocationProbe />
    </>,
    { route },
  );
}

function summaryLabels(): string[] {
  return [...document.querySelectorAll(".ui-cp-card .ui-pp-label")].map((node) => node.textContent);
}

function switchRadio(name: string): HTMLElement {
  return within(screen.getByRole("radiogroup", { name: "תקופה" })).getByRole("radio", { name });
}

describe("the period switch", () => {
  it("opens on the month, its labels this month and this year", () => {
    renderPage();
    const group = screen.getByRole("radiogroup", { name: "תקופה" });
    expect(within(group).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual(["אוקטובר", "2026", "מההתחלה"]);
    expect(switchRadio("אוקטובר")).toHaveAttribute("aria-checked", "true");
    // The month view is today's page.
    expect(summaryLabels()).toEqual(["הכנסות", "הוצאות שנספרות ברווח", "רווח אוקטובר", "רווח מתחילת השנה"]);
  });

  it("2026: the year to date, its forecast card and chart, its months newest first", () => {
    renderPage();
    fireEvent.click(switchRadio("2026"));
    expect(screen.getByTestId("search").textContent).toBe("?period=year");
    expect(switchRadio("2026")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("2026 · עד היום, 11/10")).toBeInTheDocument();
    expect(document.querySelector(".ui-cp-figure")?.textContent).toContain("36,274");
    expect(summaryLabels()).toEqual(["הכנסות", "הוצאות שנספרות ברווח", "רווח 2026 עד היום", "רווח 2025 כולה"]);
    const card = document.querySelector(".ui-cp-head .ui-fc-card");
    expect(card?.textContent).toContain("סוף 2026");
    expect(card?.textContent).toContain("רווח עד היום");
    expect(card?.textContent).toContain("רווח צפוי ל־2026");
    expect(card?.textContent).toContain("נובמבר ודצמבר");
    expect(screen.getByRole("img", { name: "הכנסות והוצאות לפי חודש ב־2026, וצפי לנובמבר ודצמבר" })).toBeInTheDocument();
    const names = [...document.querySelectorAll(".ui-cp-period-list .ui-cp-name")].map((node) => node.textContent);
    expect(names.slice(0, 2)).toEqual(["אוקטובר · עד היום", "ספטמבר"]);
    expect(names).toHaveLength(10);
  });

  it("this month's row opens the month view", () => {
    renderPage("/profit?period=year");
    fireEvent.click(screen.getByRole("button", { name: /^אוקטובר · עד היום/ }));
    expect(screen.getByTestId("search").textContent).toBe("");
    expect(switchRadio("אוקטובר")).toHaveAttribute("aria-checked", "true");
  });

  it("by project: each project's year, the finished ones in one row, a project opening its profit page", () => {
    renderPage("/profit?period=year");
    fireEvent.click(screen.getAllByRole("button", { name: "לפי פרויקט" })[0] as HTMLElement);
    expect(screen.getByTestId("search").textContent).toBe("?period=year&list=project");
    const list = document.querySelector(".ui-cp-period-list");
    if (!(list instanceof HTMLElement)) throw new Error("no list");
    expect(within(list).getByText("פרויקטים שהסתיימו · 4").closest("a")).toBeNull();
    expect(within(list).getByText("דירת הרימון").closest("a")?.getAttribute("href")).toBe("/projects/p3/profit?from=profit");
    expect(within(list).getByText("כללי").closest("a")).toBeNull();
  });

  it("מההתחלה: since the start, the years' chart and list; a year opens a closed year", () => {
    renderPage();
    fireEvent.click(switchRadio("מההתחלה"));
    expect(screen.getByTestId("search").textContent).toBe("?period=all");
    expect(screen.getByText("מאז ינואר 2024 · 3 שנים")).toBeInTheDocument();
    expect(document.querySelector(".ui-cp-figure")?.textContent).toContain("96,524");
    expect(summaryLabels()).toEqual(["הכנסות", "הוצאות שנספרות ברווח", "רווח מתחילת הדרך", "השנה הרווחית ביותר · 2025"]);
    expect(screen.getByText("הכנסות והוצאות לפי שנה")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^הכנסות לפי שנה: 2024 \$148,600, 2025 \$291,400, 2026 עד היום \$262,227 וצפי לסוף השנה/ })).toBeInTheDocument();
    // No forecast card and no chips since the start.
    expect(document.querySelector(".ui-cp-head .ui-fc-card")).toBeNull();
    expect(screen.queryByRole("button", { name: "לפי פרויקט" })).toBeNull();
    const years = screen.getByRole("region", { name: "לפי שנה" });
    expect(within(years).getAllByRole("button").map((row) => row.querySelector(".ui-cp-name")?.textContent)).toEqual(["2026 · עד היום", "2025", "2024"]);
    fireEvent.click(within(years).getByRole("button", { name: /^2025/ }));
    expect(screen.getByTestId("search").textContent).toBe("?period=year&year=2025");
    expect(switchRadio("2025")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("2025 · שנה סגורה")).toBeInTheDocument();
    expect(summaryLabels()).toEqual(["הכנסות", "הוצאות שנספרות ברווח", "רווח 2025", "רווח 2024 כולה"]);
    expect(document.querySelector(".ui-cp-head .ui-fc-card")).toBeNull();
    expect(screen.getByRole("img", { name: "הכנסות והוצאות לפי חודש ב־2025" })).toBeInTheDocument();
    expect(document.querySelectorAll(".ui-cp-head .ui-fc-ahead")).toHaveLength(0);
  });

  it("the year's forecast adds the months left to the profit to date", () => {
    renderPage("/profit?period=year");
    const card = document.querySelector(".ui-cp-head .ui-fc-card");
    if (!(card instanceof HTMLElement)) throw new Error("no card");
    const amounts = [...card.querySelectorAll(".ui-num")].map((node) => node.textContent);
    const minor = (text: string) => {
      const negative = text.includes("−");
      const value = BigInt(text.replace(/[^\d]/g, "") || "0");
      return negative ? -value : value;
    };
    // start, income, expense, net — whole dollars on the card.
    const [start, income, expense, net] = amounts.map(minor);
    expect(start).toBe(36_274n);
    expect(net).toBe((start ?? 0n) + (income ?? 0n) - (expense ?? 0n));
  });
});
