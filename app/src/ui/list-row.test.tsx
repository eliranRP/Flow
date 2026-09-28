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
          <ListRow variant="review" title="חשבונית" agorot={450000n} status="ממתין" />
          <ListRow variant="supplier" title="ביטוח המגן" vatExempt />
        </>
      </MemoryRouter>,
    );
    expectTarget(screen.getByRole("link", { name: /הרצל/ }));
    expect(screen.getByText("−₪10,000")).toHaveClass("ui-loss");
    expect(screen.getByText("חשבונית")).toBeInTheDocument();
    expect(screen.getByText("ממתין")).toBeInTheDocument();
    expect(screen.getByText("פטור ממע״מ")).toBeInTheDocument();
    expect(screen.getByText("₪12,000")).toBeInTheDocument();
  });
});
