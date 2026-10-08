import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { expectedMonthLabel, expectedMonthViews, hasExpectedHistory, missingBillHref, missingBillViews, missingBillsTitle } from "./forecast";
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
  it("maps each late bill to a row: name, the due day, the unsigned amount, and Search on that supplier", () => {
    const rows = missingBillViews(SAMPLE_MISSING_BILLS, "", now);
    expect(rows.map((row) => [row.name, row.due, row.minor, row.currency])).toEqual([
      ["מים טובים", "עד 06/10", 48_000n, "ILS"],
      ["אור חשמל", "עד 07/10", 185_000n, "ILS"],
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

  it("draws one row per bill with the amount after כ־, and a calm empty state", () => {
    const rows = missingBillViews([...SAMPLE_MISSING_BILLS, SAMPLE_MISSING_USD], "", now);
    const { unmount } = render(
      <MemoryRouter>
        <MissingBillList rows={rows} />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links[1]?.getAttribute("aria-label")).toBe("אור חשמל, עד 07/10, בערך ₪1,850");
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

  it("lists the open month's parties not seen yet, and every party for later months, expenses first by size", () => {
    const [october, november] = expectedMonthViews(SAMPLE_EXPECTED);
    expect(october?.parties.map((party) => party.name)).toEqual(["אור חשמל", "שי ניקיון"]);
    expect(november?.parties.map((party) => [party.name, party.direction, party.minor])).toEqual([
      ["אור חשמל", "expense", 185_000n],
      ["בטוח בית", "expense", 126_000n],
      ["גז הצפון", "expense", 50_000n],
      ["שי ניקיון", "expense", 48_000n],
      ["שוכר לדוגמה", "income", 1_200_000n],
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
