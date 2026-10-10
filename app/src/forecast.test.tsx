import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { expectedMonthLabel, expectedMonthViews, hasExpectedHistory, missingBillHref, missingBillPlace, missingBillViews, missingBillsTitle, usualDayText, chargeChangeViews } from "./forecast";
import {
  SAMPLE_EXPECTED,
  SAMPLE_EXPECTED_EMPTY,
  SAMPLE_EXPECTED_OPEN_DONE,
  SAMPLE_EXPECTED_TWO_CURRENCIES,
  SAMPLE_MISSING_BILLS,
  SAMPLE_MISSING_USD,
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
      ["מים טובים", "בדרך כלל ב־1 לחודש · אחרון 01/09", 48_000n, "ILS"],
      ["אור חשמל", "בדרך כלל ב־2 לחודש · אחרון 02/09", 185_000n, "ILS"],
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
    const [row] = missingBillViews([{ ...first, supplier_name: "" }], "", now);
    expect(row?.name).toBe("ללא שם");
  });

  it("names where a late bill files, either half alone, and leaves the line out when neither is known (FLOW-415)", () => {
    const names = { project: (id: string) => (id === "p1" ? "בניין לדוגמה" : undefined), category: (id: string) => (id === "c1" ? "חשמל" : undefined) };
    expect(missingBillPlace({ project_id: "p1", category_id: "c1" }, names)).toBe("בניין לדוגמה · חשמל");
    expect(missingBillPlace({ project_id: "p1", category_id: null }, names)).toBe("בניין לדוגמה");
    expect(missingBillPlace({ project_id: null, category_id: "c1" }, names)).toBe("חשמל");
    expect(missingBillPlace({ project_id: "gone", category_id: null }, names)).toBeNull();
    expect(missingBillPlace({ project_id: "p1", category_id: "c1" })).toBeNull();
    // No last bill: the day alone; a last bill in another year carries its year.
    expect(usualDayText(4, null, now)).toBe("בדרך כלל ב־4 לחודש");
    expect(usualDayText(4, "2025-12-04", now)).toBe("בדרך כלל ב־4 לחודש · אחרון 04/12/2025");
  });

  it("words a payment off its usual amount for Home from the server's percent (FLOW-415)", () => {
    const [up, down] = chargeChangeViews([
      { transaction_id: "t1", category_name: "חשמל", currency: "ILS", amount_minor: -255_000n, typical_amount_minor: -185_000n, change_percent: 38 },
      { transaction_id: "t2", category_name: null, currency: "USD", amount_minor: -15_000n, typical_amount_minor: -20_000n, change_percent: -25 },
    ], "?preview=1");
    expect(up).toEqual({ id: "t1", title: "חשמל עלה ב־38%", now: "₪2,550", usual: "₪1,850", href: "/transactions/t1?preview=1" });
    expect(down?.title).toBe("ללא קטגוריה ירד ב־25%");
    expect(down?.now).toBe("$150");
    const rows = attentionRows({ pending: 2, unpaidCount: 0, unpaidGross: 0n, missingCount: 2, changes: up ? [up] : [], search: "" });
    expect(rows.map((row) => row.id)).toEqual(["review", "missing", "change:t1"]);
    render(<MemoryRouter><span>{rows[2]?.hint}</span></MemoryRouter>);
    expect(screen.getByText(/בדרך כלל/).textContent).toBe("₪2,550 · בדרך כלל ₪1,850");
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
    expect(missing?.to).toBe("/missing-bills?preview=1");
    expect(missing?.hint).toBeUndefined();
  });

  it("draws one row per bill with its hint lines and the amount after כ־, and a calm empty state", () => {
    const rows = missingBillViews([...SAMPLE_MISSING_BILLS, SAMPLE_MISSING_USD], "", now, { project: () => "בניין לדוגמה" });
    const { unmount } = render(
      <MemoryRouter>
        <MissingBillList rows={rows} />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links[1]?.getAttribute("aria-label")).toBe("אור חשמל, בניין לדוגמה, בדרך כלל ב־2 לחודש · אחרון 02/09, בערך ₪1,850");
    // FLOW-415: a bill that files nowhere has one hint line, when it usually comes.
    expect(links[0]?.querySelectorAll(".ui-row-hint")).toHaveLength(1);
    expect(links[1]?.querySelectorAll(".ui-row-hint")).toHaveLength(2);
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
