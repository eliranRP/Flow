import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ListRow } from "./list-row";
import { SuggestTag } from "./suggest-tag";
import { expectRtl, expectTarget } from "./test-support";

describe("ListRow", () => {
  it("renders project, transaction, review, and supplier rows", () => {
    expectRtl();
    render(
      <MemoryRouter>
        <>
          <ListRow variant="project" title="הרצל" hint="רווחיות 27%" agorot={20000000n} href="/projects/1" />
          <ListRow variant="project" title="הפסד" agorot={-1000000n} loss />
          <ListRow variant="transaction" title="בנק" agorot={1200000n} sign="out" source="bank" />
          <ListRow variant="item" title="ביטוח המגן" hint="ספק · פטור ממע״מ" />
        </>
      </MemoryRouter>,
    );
    expectTarget(screen.getByRole("link", { name: /הרצל/ }));
    expect(screen.getByText("−₪10,000")).toHaveClass("ui-loss");
    expect(screen.getByText("ספק · פטור ממע״מ")).toBeInTheDocument();
    const txnAmount = screen.getByText("−₪12,000");
    expect(txnAmount.closest("bdi")).toHaveAttribute("dir", "ltr");
    expect(txnAmount.textContent).toBe("−₪12,000.00");
  });

  it("renders a USD transaction amount inside one bdi and honours project currency", () => {
    render(
      <MemoryRouter>
        <>
          <ListRow variant="transaction" title="Wire" agorot={125_000n} sign="out" source="bank" currency="USD" />
          <ListRow variant="project" title="Harbor" agorot={200_000n} currency="USD" />
        </>
      </MemoryRouter>,
    );
    const usdTxn = screen.getByText("−$1,250");
    expect(usdTxn.closest("bdi")?.textContent).toBe("−$1,250.00");
    // Project rows stay whole units.
    expect(screen.getByText("$2,000").textContent).toBe("$2,000");
    expect(screen.getByText("$2,000").querySelector(".ui-num-cents")).toBeNull();
  });

  it("renders static, button, danger, and selectable rows", () => {
    render(
      <MemoryRouter>
        <>
          <ListRow variant="static" title="אלפא" hint="עוסק מורשה" />
          <ListRow variant="button" title="חיבור SUMIT" onClick={() => undefined} />
          <ListRow variant="danger" title="התנתקות" busy onClick={() => undefined} />
          <ListRow variant="selectable" title="וילה" selected onSelect={() => undefined} />
        </>
      </MemoryRouter>,
    );
    expect(screen.getByText("אלפא").closest(".ui-row")?.tagName).toBe("DIV");
    expect(screen.getByText("אלפא").closest(".ui-row-main")?.tagName).toBe("DIV");
    expect(screen.getByRole("button", { name: "חיבור SUMIT" }).querySelector(".ui-row-main")?.tagName).toBe("SPAN");
    expect(screen.getByRole("button", { name: "התנתקות" }).querySelector(".ui-row-text")?.tagName).toBe("SPAN");
    expect(screen.getByText("אלפא").closest(".ui-row")).not.toHaveClass("ui-hit");
    expect(screen.getByRole("button", { name: "חיבור SUMIT" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "התנתקות" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "וילה" })).toHaveAttribute("aria-pressed", "true");
  });

  it("uses a heading only on a static row", () => {
    render(
      <MemoryRouter>
        <>
          <ListRow variant="static" title="פג תוקף" heading />
          <ListRow variant="button" title="שורה" heading onClick={() => undefined} />
        </>
      </MemoryRouter>,
    );
    const heading = screen.getByRole("heading", { name: "פג תוקף" });
    expect(heading.tagName).toBe("H3");
    expect(heading.closest("span")).toBeNull();
    expect(screen.getByRole("button", { name: "שורה" }).querySelector("[role='heading']")).toBeNull();
    expect(screen.queryByRole("heading", { name: "שורה" })).not.toBeInTheDocument();
  });

  it("keeps an ltr title from the start", () => {
    render(
      <MemoryRouter>
        <ListRow variant="static" title="owner@example.com" ltrTitle />
      </MemoryRouter>,
    );
    const email = screen.getByText("owner@example.com");
    expect(email.tagName).toBe("BDI");
    expect(email).toHaveAttribute("dir", "ltr");
    expect(email.closest(".ui-row-title")).toHaveAttribute("dir", "ltr");
    expect(email.closest(".ui-row")?.tagName).toBe("DIV");
  });

  it("drops the chevron on a static row and exposes aria-expanded on a disclosure", () => {
    const { container } = render(
      <MemoryRouter>
        <>
          <ListRow variant="static" title="אלפא" chevron />
          <ListRow variant="button" title="חשבונית ותשלום" expanded onClick={() => undefined} />
        </>
      </MemoryRouter>,
    );
    expect(container.querySelector(".ui-row-chevron")).toBeNull();
    expect(screen.getByRole("button", { name: "חשבונית ותשלום" })).toHaveAttribute("aria-expanded", "true");
  });

  it("shows a spinner instead of the icon and hides the chevron while a button row is busy", () => {
    render(
      <MemoryRouter>
        <ListRow variant="button" title="מרענן…" icon={<svg data-testid="row-icon" />} chevron busy onClick={() => undefined} />
      </MemoryRouter>,
    );
    const button = screen.getByRole("button", { name: "מרענן…" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector(".ui-spinner")).not.toBeNull();
    expect(screen.queryByTestId("row-icon")).toBeNull();
    expect(button.querySelector(".ui-row-chevron")).toBeNull();
  });

  it("ignores taps on a busy button row", () => {
    const onClick = vi.fn();
    render(
      <MemoryRouter>
        <ListRow variant="button" title="מרענן…" busy onClick={onClick} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "מרענן…" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("hides the chevron on a disabled row and keeps a clear hint at full opacity", () => {
    render(
      <MemoryRouter>
        <ListRow
          variant="button"
          title="רענון עכשיו"
          hint={<>אפשר לנסות שוב ב-<bdi dir="ltr">12:00</bdi></>}
          chevron
          disabled
          clearHint
          onClick={() => undefined}
        />
      </MemoryRouter>,
    );
    const button = screen.getByRole("button", { name: /רענון עכשיו/ });
    expect(button).toBeDisabled();
    expect(button.querySelector(".ui-row-chevron")).toBeNull();
    expect(button).toHaveClass("ui-row-clear-hint");
    expect(getComputedStyle(button.querySelector(".ui-row-hint") as Element).opacity).toBe("1");
  });

  it("keeps an aria-disabled row focusable and ignores the click", () => {
    const onClick = vi.fn();
    render(
      <MemoryRouter>
        <ListRow
          variant="button"
          title="עוזר AI"
          hint="אין עסק עדיין"
          describeHint
          clearHint
          ariaDisabled
          onClick={onClick}
        />
      </MemoryRouter>,
    );
    const row = screen.getByRole("button", { name: "עוזר AI" });
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).not.toHaveAttribute("disabled");
    expect(row).toHaveClass("ui-row-clear-hint");
    expect(row.querySelector(".ui-row-chevron")).toBeNull();
    row.focus();
    expect(row).toHaveFocus();
    fireEvent.click(row);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("truncates a long suggestion name and keeps הצעה in the row", () => {
    const name = "חומרי בניין והובלה כללית בע״מ סניף רעננה המרכזי והסביבה הקרובה";
    render(
      <MemoryRouter>
        <div style={{ inlineSize: "320px" }}>
          <ListRow
            variant="button"
            eyebrow="קטגוריה"
            title={name}
            label={`קטגוריה: ${name}, הצעה`}
            tag={<SuggestTag />}
            onClick={() => undefined}
          />
        </div>
      </MemoryRouter>,
    );
    const text = document.querySelector(".ui-row-title-text");
    const tag = document.querySelector(".ui-suggest-tag");
    const title = text?.parentElement;
    expect(text).not.toBeNull();
    expect(tag).not.toBeNull();
    expect(title).toBe(tag?.parentElement);
    expect(title).toHaveClass("ui-row-title-with-tag");
    expect(getComputedStyle(text as Element).textOverflow).toBe("ellipsis");
    expect(getComputedStyle(text as Element).overflow).toBe("hidden");
    expect(getComputedStyle(title as Element).overflow).toBe("visible");
  });

  it("keeps a long change-sheet name at the start, beside הצעה", () => {
    const name = "חומרי בניין והובלה כללית בע״מ סניף רעננה המרכזי והסביבה הקרובה";
    render(
      <MemoryRouter>
        <div className="ui-change-summary" style={{ inlineSize: "320px" }}>
          <ListRow
            variant="button"
            eyebrow="קטגוריה"
            title={name}
            label={`קטגוריה: ${name}, הצעה`}
            tag={<SuggestTag />}
            onClick={() => undefined}
          />
        </div>
      </MemoryRouter>,
    );
    const text = document.querySelector(".ui-row-title-text");
    const title = text?.parentElement;
    expect(text).not.toBeNull();
    expect(title).toHaveClass("ui-row-title-with-tag");
    const textStyle = getComputedStyle(text as Element);
    expect(textStyle.flexGrow).toBe("0");
    expect(textStyle.whiteSpace).toBe("normal");
    expect(textStyle.textOverflow).toBe("clip");
    expect(textStyle.textAlign).toBe("start");
    expect(getComputedStyle(title as Element).justifyContent).toBe("flex-start");
  });

  it("paints a linked transaction row in the warning tone", () => {
    render(
      <MemoryRouter>
        <ListRow variant="transaction" title="משכנתא" hint="ממתין לבדיקה" tone="warning" agorot={-245000n} sign="out" source="invoice" href="/transactions/1" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /משכנתא/ })).toHaveClass("ui-row-tone-warning");
  });

  it("draws an income row green with a hidden הכנסה and no plus, an expense row with a minus in text", () => {
    const { container } = render(
      <MemoryRouter>
        <>
          <ListRow variant="transaction" title="לקוח לדוגמה" agorot={350000n} sign="in" source="invoice" href="/transactions/9" />
          <ListRow variant="transaction" title="ספק לדוגמה" agorot={120000n} sign="out" source="bank" />
        </>
      </MemoryRouter>,
    );
    const income = screen.getByText("₪3,500");
    expect(income).toHaveClass("ui-income");
    expect(income.textContent).not.toContain("+");
    expect(screen.getByRole("link", { name: /הכנסה/ })).toHaveTextContent("הכנסה ₪3,500.00");
    expect(container.querySelector(".sr-only")?.textContent).toBe("הכנסה ");
    const expense = screen.getByText("−₪1,200");
    expect(expense).not.toHaveClass("ui-income");
    expect(expense.closest(".t-amount")).not.toBeNull();
  });

  it("shows transaction cents small and raised, .00 included, and keeps project rows whole (decision 0114, option C)", () => {
    const { container } = render(
      <MemoryRouter>
        <>
          <ListRow variant="transaction" title="לקוח לדוגמה" agorot={123_456n} sign="in" source="invoice" />
          <ListRow variant="transaction" title="ספק לדוגמה" agorot={50_000n} sign="out" source="bank" />
          <ListRow variant="project" title="פרויקט לדוגמה" agorot={98_765n} />
        </>
      </MemoryRouter>,
    );
    const figures = Array.from(container.querySelectorAll("bdi.ui-num"));
    expect(figures.map((node) => node.textContent)).toEqual(["₪1,234.56", "−₪500.00", "₪988"]);
    expect(figures.map((node) => node.querySelector(".ui-num-cents")?.textContent ?? null)).toEqual([".56", ".00", null]);
  });

  it("draws no hairline under a row", () => {
    render(
      <MemoryRouter>
        <ListRow variant="transaction" title="ספק לדוגמה" agorot={50_000n} sign="out" source="bank" />
      </MemoryRouter>,
    );
    const row = screen.getByText("ספק לדוגמה").closest(".ui-row");
    expect(row).not.toBeNull();
    if (row instanceof HTMLElement) expect(getComputedStyle(row).borderBottomWidth).toMatch(/^(0px|0|)$/);
  });

  it("shows a negative income with its minus and no green, and names a refund זיכוי", () => {
    const { container } = render(
      <MemoryRouter>
        <>
          <ListRow variant="transaction" title="זיכוי לקוח" agorot={-20_000n} sign="in" source="invoice" />
          <ListRow variant="transaction" title="זיכוי ספק" agorot={19_400n} sign="in" inWord="זיכוי" source="invoice" />
          <ListRow variant="transaction" title="אפס" agorot={0n} sign="in" source="invoice" />
        </>
      </MemoryRouter>,
    );
    const figures = Array.from(container.querySelectorAll("bdi.ui-num"));
    expect(figures[0]?.textContent).toBe("−₪200.00");
    expect(figures[0]).not.toHaveClass("ui-income");
    expect(figures[1]).toHaveClass("ui-income");
    expect(figures[2]).not.toHaveClass("ui-income");
    expect(Array.from(container.querySelectorAll(".sr-only")).map((node) => node.textContent)).toEqual(["זיכוי ", "הכנסה "]);
  });

  it("keeps a described field hint at the hint size", () => {
    render(
      <MemoryRouter>
        <ListRow variant="button" title="חיבור לדוגמה" hint="מחובר" describeHint onClick={() => undefined} />
      </MemoryRouter>,
    );
    const hint = screen.getByText("מחובר");
    expect(hint).toHaveClass("t-hint");
    // jsdom keeps the custom property unresolved, so the token name is what is compared.
    expect(getComputedStyle(hint).fontSize).toBe("var(--type-hint-size)");
  });
});
