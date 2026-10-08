import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ListRow } from "./list-row";
import { matchRange } from "./match-text";

describe("matchRange (FLOW-323)", () => {
  it("finds the typed text in any case, trimmed", () => {
    expect(matchRange("Northwind Traders", "  trad ")).toEqual({ start: 10, end: 14 });
    expect(matchRange("חומרי בניין", "בניין")).toEqual({ start: 6, end: 11 });
  });

  it("is null for no text or no match", () => {
    expect(matchRange("חומרי בניין", "")).toBeNull();
    expect(matchRange("חומרי בניין", undefined)).toBeNull();
    expect(matchRange("חומרי בניין", "מלט")).toBeNull();
  });
});

describe("statement row details and tint", () => {
  it("tints the match, draws line 2, and reads the details in the link name", () => {
    render(
      <MemoryRouter>
        <ListRow
          variant="statement"
          title="חומרי בניין לדוגמה"
          fallback="invoice"
          match="בניין"
          details={[{ text: "08/10" }, { text: "ממתינה לאישור", tone: "accent" }]}
          agorot={-12_400n}
          sign="out"
          href="/transactions/t1"
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAccessibleName("חומרי בניין לדוגמה, 08/10, ממתינה לאישור, הוצאה −₪124.00");
    expect(within(link).getByText("בניין", { selector: "mark" })).toHaveClass("ui-match");
    expect(within(link).getByText("ממתינה לאישור")).toHaveClass("ui-statement-accent");
  });

  it("keeps the plain row when there is nothing to add", () => {
    render(
      <MemoryRouter>
        <ListRow variant="statement" title="ספק" fallback="invoice" agorot={-100n} sign="out" href="/x" />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link");
    expect(link.querySelector("mark")).toBeNull();
    expect(link.querySelector(".ui-statement-line")).toBeNull();
  });
});
