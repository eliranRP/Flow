import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PartDraft } from "../line-split";
import { SignedCheck, categoryNet, creditNote, partMinor } from "./line-split-credit";
import { shareText } from "./line-split-parts";

/** FLOW-954 (board LedgerSplitContra): a credit part's net and the header's signed check. Invented figures. */
const cost: PartDraft = { key: "a", categoryId: "c-tax", projectId: "p1", unit: "amount", value: "249.48" };
const credit: PartDraft = { key: "b", categoryId: "c-tax", projectId: "p1", unit: "amount", value: "850.77", grossUp: true };
const other: PartDraft = { key: "c", categoryId: "c-build", projectId: "p1", unit: "percent", value: "10" };
const minorOf = (part: PartDraft) => partMinor(part, 100_000n, undefined);

describe("a part's share of the line", () => {
  it("is whole percents, with one decimal below 1%", () => {
    expect(shareText(0.31)).toBe("0.3");
    expect(shareText(0)).toBe("0");
    expect(shareText(30.4)).toBe("30");
    expect(shareText(1234.6)).toBe("1,235");
  });
});

describe("a credit part (זיכוי)", () => {
  it("a part's money: its amount, or its percent's cents", () => {
    expect(partMinor(cost, 100_000n, undefined)).toBe(24_948n);
    expect(partMinor(other, 100_000n, undefined)).toBe(10_000n);
    expect(partMinor(other, 100_000n, 9_999n)).toBe(9_999n);
  });

  it("a category with a normal and a credit part nets the credits less the costs", () => {
    expect(categoryNet([cost, credit, other], "c-tax", minorOf)).toBe(60_129n);
    expect(categoryNet([{ ...cost, value: "900" }, credit], "c-tax", minorOf)).toBe(-4_923n);
    // Only one kind on the category: no net.
    expect(categoryNet([credit, other], "c-tax", minorOf)).toBeNull();
    expect(categoryNet([cost, other], "c-tax", minorOf)).toBeNull();
    // A value still missing: no net yet.
    expect(categoryNet([{ ...cost, value: "" }, credit], "c-tax", minorOf)).toBeNull();
  });

  it("the note names the category's net, with + and זיכוי on a credit", () => {
    render(<p>{creditNote(60_129n, "מסים על הנכס", "USD")}</p>);
    expect(screen.getByText(/נטו במסים על הנכס/).textContent).toBe("יורד מהסכום · נטו במסים על הנכס: +$601.29 זיכוי");
  });

  it("the note without a pair is only that it comes off the line", () => {
    render(<p data-testid="note">{creditNote(null, "מסים על הנכס", "USD")}</p>);
    expect(screen.getByTestId("note").textContent).toBe("יורד מהסכום");
  });

  it("the header's check signs each part, adds the rest, and equals the line", () => {
    render(<SignedCheck terms={[{ minor: 24_948n, credit: false }, { minor: 85_077n, credit: true }]} rest={8_034_714n} lineMinor={7_974_585n} currency="USD" />);
    expect(screen.getByText(/תואם לשורה/).textContent).toBe("תואם לשורה · $249.48 − $850.77 + $80,347.14 = $79,745.85");
  });
});
