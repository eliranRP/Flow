import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  chargeChangeViews,
  expectedMonthLabel,
  expectedMonthViews,
  hasExpectedHistory,
  lateCounts,
  missingBillsTitle,
} from "./forecast";
import { arrivedViews, missingBillHref, missingBillPlace, missingBillViews, usualDayText } from "./recurring";
import {
  SAMPLE_EXPECTED,
  SAMPLE_EXPECTED_EMPTY,
  SAMPLE_EXPECTED_OPEN_DONE,
  SAMPLE_EXPECTED_TWO_CURRENCIES,
  SAMPLE_MISSING_BILLS,
  SAMPLE_MISSING_INCOME,
  SAMPLE_MISSING_USD,
  SAMPLE_RECURRING_CHANGES,
  SAMPLE_RECURRING_THIS_MONTH,
} from "./forecast-sample";
import { attentionRows } from "./screens/HomeScreen";
import { ApproxAmount } from "./ui/approx-amount";
import { ExpectedMonths } from "./ui/expected-months";
import { MissingBillList } from "./ui/missing-bill-list";

const now = new Date("2026-10-08T09:00:00Z");

describe("missing bills", () => {
  it("maps each late bill to a row: name, when it usually comes, the unsigned amount, and Search on that supplier", () => {
    const rows = missingBillViews(SAMPLE_MISSING_BILLS, "", now);
    expect(rows.map((row) => [row.name, row.usual, row.minor, row.currency])).toEqual([
      ["מים טובים", "כל חודש ב־1 · אחרון 01/09", 48_000n, "ILS"],
      ["אור חשמל", "כל חודש ב־2 · אחרון 02/09", 185_000n, "ILS"],
    ]);
    const href = new URL(rows[1]?.href ?? "", "https://example.com");
    expect(href.pathname).toBe("/search");
    expect(href.searchParams.get("q")).toBe("אור חשמל");
    expect(href.searchParams.get("dir")).toBe("expense");
  });

  it("keeps the preview flag on the Search link and cuts a long name to the server's limit", () => {
    const href = new URL(missingBillHref("א".repeat(150), "?preview=1"), "https://example.com");
    expect(href.searchParams.get("preview")).toBe("1");
    expect(href.searchParams.get("q")).toHaveLength(100);
  });

  it("names a supplier with no name ללא שם, so the row is never blank", () => {
    const first = SAMPLE_MISSING_BILLS[0];
    if (first == null) throw new Error("sample");
    const [row] = missingBillViews([{ ...first, supplier_name: "", party_name: "" }], "", now);
    expect(row?.name).toBe("ללא שם");
  });

  it("names where a late bill files, either half alone, and leaves the line out when neither is known (FLOW-415)", () => {
    expect(missingBillPlace({ project_name: "בניין לדוגמה", category_name: "חשמל" })).toBe("בניין לדוגמה · חשמל");
    expect(missingBillPlace({ project_name: "בניין לדוגמה", category_name: null })).toBe("בניין לדוגמה");
    expect(missingBillPlace({ project_name: "", category_name: "חשמל" })).toBe("חשמל");
    expect(missingBillPlace({ project_name: null })).toBeNull();
    expect(missingBillPlace({})).toBeNull();
    // No last bill: the day alone; a last bill in another year carries its year.
    expect(usualDayText(4, null, now)).toBe("כל חודש ב־4");
    expect(usualDayText(4, "2025-12-04", now)).toBe("כל חודש ב־4 · אחרון 04/12/2025");
  });

  it("words a payment off its usual amount for Home from the server's percent (FLOW-415)", () => {
    const [up, down] = chargeChangeViews([
      { supplier_id: "s1", supplier_name: "אור חשמל", transaction_id: "t1", category_name: "חשמל", currency: "ILS", amount_minor: -255_000n, typical_amount_minor: -185_000n, change_percent: 38 },
      { supplier_id: "s2", supplier_name: "ענן לדוגמה", transaction_id: "t2", category_name: null, currency: "USD", amount_minor: -15_000n, typical_amount_minor: -20_000n, change_percent: -25 },
    ], "?preview=1");
    expect(up).toEqual({ id: "t1", title: "חשמל עלה ב־38%", down: false, now: "₪2,550", usual: "₪1,850", href: "/transactions/t1?preview=1" });
    // No category: the supplier's name, and a drop.
    expect(down?.title).toBe("ענן לדוגמה ירד ב־25%");
    expect(down?.down).toBe(true);
    expect(down?.now).toBe("$150");
    const rows = attentionRows({ pending: 2, unpaidCount: 0, unpaidGross: 0n, missingCount: 2, changes: up ? [up] : [], search: "" });
    expect(rows.map((row) => row.id)).toEqual(["review", "missing", "change:t1"]);
    const { container } = render(<MemoryRouter><span>{rows[2]?.hint}</span></MemoryRouter>);
    // Each half wraps whole, and the "·" opens the second half, where a wrap clips it.
    expect([...container.querySelectorAll(".ui-hint-wrap-part")].map((part) => part.textContent)).toEqual(["₪2,550", " · בדרך כלל ₪1,850"]);
  });

  it("titles the Home row with a count only, singular for one", () => {
    expect(missingBillsTitle(1)).toBe("חשבון אחד לא הגיע");
    expect(missingBillsTitle(3)).toBe("3 חשבונות לא הגיעו");
  });

  it("adds the late-bills row to the pending card only when a bill is late, last, with no hint", () => {
    const none = attentionRows({ pending: 2, unpaidCount: 1, unpaidGross: 100n, search: "" });
    expect(none.map((row) => row.id)).toEqual(["review", "unpaid"]);
    const rows = attentionRows({ pending: 2, unpaidCount: 1, unpaidGross: 100n, missingCount: 2, search: "?preview=1" });
    expect(rows.map((row) => row.id)).toEqual(["review", "unpaid", "missing"]);
    const missing = rows[2];
    // FLOW-415 (b-2): it opens the קבועים screen at לא הגיעו.
    expect(missing?.to).toBe("/missing-bills?preview=1#late");
    expect(missing?.hint).toBeUndefined();
  });

  it("draws one row per bill with its hint lines and the amount after כ־, and a calm empty state", () => {
    const rows = missingBillViews([...SAMPLE_MISSING_BILLS, SAMPLE_MISSING_USD], "", now);
    const { unmount } = render(
      <MemoryRouter>
        <MissingBillList rows={rows} />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links[1]?.getAttribute("aria-label")).toBe("אור חשמל, בניין הדקל · חשמל, כל חודש ב־2 · אחרון 02/09, בערך ₪1,850");
    // FLOW-415: a bill that files nowhere has one hint line, when it usually comes.
    expect(links[1]?.querySelectorAll(".ui-row-hint")).toHaveLength(2);
    expect(links[2]?.querySelectorAll(".ui-row-hint")).toHaveLength(1);
    expect(links[2]?.textContent).toContain("$20");
    unmount();
    render(
      <MemoryRouter>
        <MissingBillList rows={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByText("הכל הגיע")).toBeTruthy();
  });
});

describe("the קבועים screen (FLOW-415, b-2)", () => {
  it("words late income on its own Home row, and links search to the customer's side", () => {
    const [income] = missingBillViews([SAMPLE_MISSING_INCOME], "", now);
    expect(income?.name).toBe("שוכר לדוגמה");
    expect(income?.income).toBe(true);
    expect(new URL(income?.href ?? "", "https://example.com").searchParams.get("dir")).toBe("income");
    expect(income?.alertKey).toBe(SAMPLE_MISSING_INCOME.alert_key);
    expect(lateCounts([...SAMPLE_MISSING_BILLS, SAMPLE_MISSING_INCOME])).toEqual({ expense: 2, income: 1 });
    expect(missingBillsTitle(1, true)).toBe("תנועה קבועה אחת לא הגיעה");
    expect(missingBillsTitle(2, true)).toBe("2 תנועות קבועות לא הגיעו");
    const rows = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, missingCount: 2, missingIncome: 1, search: "" });
    expect(rows.map((row) => [row.id, row.to])).toEqual([["missing", "/missing-bills#late"], ["missing-income", "/missing-bills#late"]]);
    expect(rows[1]?.title).toBe("תנועה קבועה אחת לא הגיעה");
  });

  it("names the pace before the day", () => {
    expect(usualDayText(4, null, now, "2months")).toBe("כל חודשיים ב־4");
    expect(usualDayText(4, null, now, "year")).toBe("כל שנה ב־4");
  });

  it("opens one change's payment, and shares one row for two or more that opens הגיעו החודש", () => {
    const one = chargeChangeViews(SAMPLE_RECURRING_CHANGES, "");
    expect(attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, changes: one, search: "" }).map((row) => row.to)).toEqual(["/transactions/t-power-oct"]);
    const two = chargeChangeViews(SAMPLE_RECURRING_THIS_MONTH.slice(0, 2), "?preview=1");
    const [row] = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, changes: two, search: "?preview=1" });
    expect(row?.id).toBe("changes");
    expect(row?.to).toBe("/missing-bills?preview=1#arrived");
    const { container } = render(<MemoryRouter><span>{row?.title}</span></MemoryRouter>);
    expect(container.textContent).toBe("2 חיובים קבועים השתנו");
  });

  it("marks a change only while this user has not hidden it, red when it is bad news", () => {
    const shown = arrivedViews(SAMPLE_RECURRING_THIS_MONTH, SAMPLE_RECURRING_CHANGES, "");
    expect(shown.map((row) => [row.name, row.changePercent, row.alertKey])).toEqual([
      ["אור חשמל", 38, "t-power-oct"],
      ["ארנונה עירונית", null, null],
      ["ביטוח דוגמה", null, null],
    ]);
    expect(shown[0]?.worse).toBe(true);
    expect(shown[0]?.href).toBe("/transactions/t-power-oct");
    // Hidden: the row stays, its percent and ✕ go.
    const hidden = arrivedViews(SAMPLE_RECURRING_THIS_MONTH, [], "");
    expect(hidden[0]?.changePercent).toBeNull();
    // Income down is the bad news.
    const [rent] = arrivedViews([{ ...SAMPLE_RECURRING_THIS_MONTH[0], direction: "income", change_percent: -30 } as (typeof SAMPLE_RECURRING_THIS_MONTH)[number]], [], "");
    expect(rent?.worse).toBe(true);
  });

  it("draws both sections, and hides a late row or a change with the ✕", () => {
    const onHide = vi.fn();
    render(
      <MemoryRouter>
        <MissingBillList
          rows={missingBillViews(SAMPLE_MISSING_BILLS, "", now)}
          arrived={arrivedViews(SAMPLE_RECURRING_THIS_MONTH, SAMPLE_RECURRING_CHANGES, "")}
          onHide={onHide}
        />
      </MemoryRouter>,
    );
    const late = screen.getByRole("region", { name: "לא הגיעו" });
    const arrived = screen.getByRole("region", { name: "הגיעו החודש" });
    expect(late.id).toBe("late");
    expect(arrived.id).toBe("arrived");
    expect(within(arrived).getAllByRole("link").map((link) => link.getAttribute("aria-label"))).toEqual([
      "אור חשמל, בניין הדקל · חשמל, ₪2,550, עלייה של 38%",
      "ארנונה עירונית, שיפוץ הרצל 12, ₪1,320",
      "ביטוח דוגמה, ביטוח, ₪410",
    ]);
    // Only the change carries a ✕ in הגיעו החודש; every late row does.
    expect(within(late).getAllByRole("button", { name: /^הסתרה, / })).toHaveLength(2);
    fireEvent.click(within(arrived).getByRole("button", { name: "הסתרה, אור חשמל" }));
    expect(onHide).toHaveBeenCalledWith("change", "t-power-oct", "אור חשמל");
    expect(within(arrived).getAllByRole("button")).toHaveLength(1);
  });
});

describe("expected months", () => {
  it("labels the open month as the rest of it", () => {
    expect(expectedMonthLabel("2026-10", true)).toBe("שאר אוקטובר");
    expect(expectedMonthLabel("2026-11", false)).toBe("נובמבר");
    expect(expectedMonthLabel("2027-01", false)).toBe("ינואר");
  });

  it("shows the expected expense per month, unsigned, never the income", () => {
    const months = expectedMonthViews(SAMPLE_EXPECTED);
    expect(months.map((month) => [month.label, month.figures])).toEqual([
      ["שאר אוקטובר", [{ currency: "ILS", minor: 233_000n }]],
      ["נובמבר", [{ currency: "ILS", minor: 409_000n }]],
      ["דצמבר", [{ currency: "ILS", minor: 409_000n }]],
    ]);
  });

  it("lists the open month's parties not seen yet, and every expense party for later months by size, never income", () => {
    const [october, november] = expectedMonthViews(SAMPLE_EXPECTED);
    expect(october?.parties.map((party) => party.name)).toEqual(["אור חשמל", "שי ניקיון"]);
    expect(november?.parties.map((party) => [party.name, party.direction, party.minor])).toEqual([
      ["אור חשמל", "expense", 185_000n],
      ["בטוח בית", "expense", 126_000n],
      ["גז לדוגמה", "expense", 50_000n],
      ["שי ניקיון", "expense", 48_000n],
    ]);
  });

  it("gives a second figure only with a second currency, and a zero for an open month with nothing left", () => {
    expect(expectedMonthViews(SAMPLE_EXPECTED_TWO_CURRENCIES)[1]?.figures).toEqual([
      { currency: "ILS", minor: 409_000n },
      { currency: "USD", minor: 2_000n },
    ]);
    const done = expectedMonthViews(SAMPLE_EXPECTED_OPEN_DONE, "ILS")[0];
    expect(done?.figures).toEqual([{ currency: "ILS", minor: 0n }]);
    expect(done?.parties).toEqual([]);
  });

  it("knows when there is no history yet", () => {
    expect(hasExpectedHistory(SAMPLE_EXPECTED)).toBe(true);
    expect(hasExpectedHistory(SAMPLE_EXPECTED_EMPTY)).toBe(false);
    expect(hasExpectedHistory(null)).toBe(false);
  });

  it("draws a month with parties as a button and an empty one as a plain row", () => {
    render(<ExpectedMonths months={expectedMonthViews(SAMPLE_EXPECTED_OPEN_DONE)} onOpen={() => undefined} />);
    const section = screen.getByRole("region", { name: "צפוי" });
    expect(within(section).getAllByRole("button")).toHaveLength(2);
    expect(within(section).getByRole("group", { name: "שאר אוקטובר, ₪0" })).toBeTruthy();
  });

  it("says there is no forecast yet in one line", () => {
    render(<ExpectedMonths months={[]} />);
    expect(screen.getByText("אין עדיין צפי.")).toBeTruthy();
  });
});

describe("ApproxAmount", () => {
  it("puts כ־ before a whole amount and drops it on a zero", () => {
    const { container, rerender } = render(<ApproxAmount minor={-185_060n} />);
    expect(container.textContent).toBe("בערך כ־₪1,851");
    rerender(<ApproxAmount minor={0n} currency="USD" />);
    expect(container.textContent).toBe("$0");
  });

  it("paints income green", () => {
    const { container } = render(<ApproxAmount minor={1_200_000n} income />);
    expect(container.querySelector(".ui-approx-income")).not.toBeNull();
  });
});
