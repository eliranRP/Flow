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
    expect(screen.getByText("₪12,000")).toBeInTheDocument();
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
});
