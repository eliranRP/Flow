import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ListRow } from "./list-row";
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
    expect(screen.getByText("אלפא").closest(".ui-row")).not.toHaveClass("ui-hit");
    expect(screen.getByRole("button", { name: "חיבור SUMIT" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "התנתקות" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "וילה" })).toHaveAttribute("aria-pressed", "true");
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
});
