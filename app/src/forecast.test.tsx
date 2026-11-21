import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { chargeChangeViews, lateItemName, lateTarget } from "./forecast";
import { monthForecastBoardSample, SAMPLE_MISSING_BILLS, SAMPLE_MISSING_INCOME, SAMPLE_RECURRING_CHANGES, SAMPLE_RECURRING_THIS_MONTH } from "./forecast-sample";
import { attentionRows } from "./screens/HomeScreen";
import { nextMonth } from "./forecast-month";

// --- forecast.test.tsx

const WATER = SAMPLE_MISSING_BILLS.find((bill) => bill.direction === "expense" && bill.party_name === "מים טובים");
const POWER = SAMPLE_MISSING_BILLS.find((bill) => bill.party_name === "אור חשמל");
const RENT = SAMPLE_MISSING_INCOME;
/** The row's title as the page draws it. */
const titleText = (title: ReactNode) => render(<MemoryRouter><span>{title}</span></MemoryRouter>).container.textContent;

describe("a late row names its one item (FLOW-1246)", () => {
  it("names the one late bill or income, and keeps the count for two or more", () => {
    if (WATER == null || POWER == null) throw new Error("sample bills missing");
    expect(lateItemName([WATER], false)).toBe("מים טובים");
    expect(lateItemName([RENT], true)).toBe("שוכר לדוגמה");
    // Each direction counts its own: one bill and one income each name their party.
    expect(lateItemName([WATER, RENT], false)).toBe("מים טובים");
    expect(lateItemName([WATER, RENT], true)).toBe("שוכר לדוגמה");
    expect(lateItemName([WATER, POWER], false)).toBeUndefined();
    expect(lateItemName([], false)).toBeUndefined();
    // A late item with no party name at all keeps the count.
    expect(lateItemName([{ ...WATER, party_name: null, supplier_name: "" }], false)).toBeUndefined();
  });

  it("titles a single late bill with its name, a single late income too, and leaves two or more as counts", () => {
    const named = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, missingCount: 1, missingName: "מים טובים", search: "" });
    expect(named.map((row) => row.id)).toEqual(["missing"]);
    expect(titleText(named[0]?.title)).toBe("החשבון של מים טובים לא הגיע");
    expect(named[0]?.short).toBe("לא הגיעו");
    expect(named[0]?.tag).toBe("חשבון אחד");
    expect(named[0]?.dismissKey).toBe("missing:1");
    // A named title is one line at 393 for a typical name; a long one may take a second line, never cut its verb.
    expect(named[0]?.wrapTitle).toBe(true);
    // The name sits in its own ellipsizing box, so a long one is cut with "…" and the verb after it still shows.
    expect(render(<MemoryRouter><span>{named[0]?.title}</span></MemoryRouter>).container.querySelector("bdi.ui-attn-name")?.textContent).toBe("מים טובים");
    const income = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, missingIncome: 1, missingIncomeName: "שוכר לדוגמה", search: "" });
    expect(titleText(income[0]?.title)).toBe("התנועה הקבועה של שוכר לדוגמה לא הגיעה");
    expect(income[0]?.tag).toBe("הכנסה אחת");
    // Two or more keep today's count wording, even when a name is passed.
    const two = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, missingCount: 2, missingName: "מים טובים", missingIncome: 2, missingIncomeName: "שוכר לדוגמה", search: "" });
    expect(two.map((row) => titleText(row.title))).toEqual(["2 חשבונות לא הגיעו", "2 תנועות קבועות לא הגיעו"]);
    expect(two.map((row) => row.wrapTitle)).toEqual([false, false]);
    // One late item with no name keeps today's wording.
    const unnamed = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, missingCount: 1, search: "" });
    expect(titleText(unnamed[0]?.title)).toBe("חשבון אחד לא הגיע");
  });
});

describe("a named late row opens its own charge (FLOW-1247)", () => {
  it("links one named bill or income to its charge page, with its project when it has one", () => {
    const water = { partyId: "s-water", projectId: null };
    const rent = { partyId: "c-rent", projectId: "p-flat" };
    const bill = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, missingCount: 1, missingName: "מים טובים", missingTarget: water, search: "?preview=1" });
    expect(bill[0]?.to).toBe("/recurring/expense/s-water?preview=1");
    const income = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, missingIncome: 1, missingIncomeName: "שוכר לדוגמה", missingIncomeTarget: rent, search: "" });
    expect(income[0]?.to).toBe("/recurring/income/c-rent?project=p-flat");
    // The dismissal key is the same as before the link changed.
    expect(income[0]?.dismissKey).toBe("missing-income:1");
  });

  it("keeps the late section's list for two or more, or a named row with no party", () => {
    const two = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, missingCount: 2, missingName: "מים טובים", missingTarget: { partyId: "s-water", projectId: null }, search: "" });
    expect(two[0]?.to).toBe("/missing-bills#late");
    const noParty = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, missingCount: 1, missingName: "מים טובים", search: "?project=p-flat" });
    expect(noParty[0]?.to).toBe("/missing-bills?project=p-flat#late");
  });

  it("finds the one late item's target only when exactly one of its direction is late", () => {
    if (WATER == null || POWER == null) throw new Error("sample bills missing");
    expect(lateTarget([WATER], false)).toEqual({ partyId: "s-water", projectId: "p2" });
    expect(lateTarget([WATER, RENT], true)).toEqual({ partyId: "c-rent", projectId: RENT.project_id ?? null });
    expect(lateTarget([WATER, POWER], false)).toBeUndefined();
    expect(lateTarget([{ ...WATER, party_id: undefined }], false)).toBeUndefined();
  });
});

describe("the קבועים screen (FLOW-415, b-2)", () => {
  it("opens one change's payment, and shares one row for two or more that opens the list of those changes", () => {
    const one = chargeChangeViews(SAMPLE_RECURRING_CHANGES, "");
    expect(attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, changes: one, search: "" }).map((row) => row.to)).toEqual(["/transactions/t-power-oct"]);
    const two = chargeChangeViews(SAMPLE_RECURRING_THIS_MONTH.slice(0, 2), "?preview=1");
    const [row] = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, changes: two, search: "?preview=1" });
    expect(row?.id).toBe("changes");
    expect(row?.to).toBe("/recurring/changes?preview=1");
    const { container } = render(<MemoryRouter><span>{row?.title}</span></MemoryRouter>);
    expect(container.textContent).toBe("2 חיובים קבועים השתנו");
    // All drops: the down arrow; an empty party name falls back to the supplier's.
    const drops = chargeChangeViews(
      SAMPLE_RECURRING_THIS_MONTH.slice(0, 2).map((change) => ({ ...change, change_percent: -30, party_name: "", category_name: null })),
      "",
    );
    expect(drops.map((change) => change.title)).toEqual(["אור חשמל ירד", "ארנונה עירונית ירד"]);
    const [dropRow] = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, changes: drops, search: "" });
    const icon = render(<MemoryRouter><span>{dropRow?.icon}</span></MemoryRouter>);
    const upIcon = render(<MemoryRouter><span>{row?.icon}</span></MemoryRouter>);
    expect(icon.container.innerHTML).not.toBe(upIcon.container.innerHTML);
  });

});

describe("the month forecast's board samples (FLOW-141b)", () => {
  it("moves the largest invoice out in the changed state: one moved item, the income without it", () => {
    const { build } = monthForecastBoardSample("changed").data;
    expect(build.changed).toBe(1);
    expect(build.moved).toHaveLength(1);
    expect(build.incomeTotal).toBe(725_000n);
    expect(build.expenseTotal).toBe(830_000n);
  });

  it("has nothing left to arrive in the empty state", () => {
    const { build } = monthForecastBoardSample("empty").data;
    expect(build.income).toHaveLength(0);
    expect(build.expense).toHaveLength(0);
    expect(build.small).toHaveLength(0);
    expect(build.moved).toHaveLength(0);
  });
});
// --- forecast-month.test.ts

describe("nextMonth (FLOW-141b)", () => {
  it("steps to the following month", () => {
    expect(nextMonth("2026-10")).toBe("2026-11");
  });

  it("rolls December into January of the next year", () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
  });
});