import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorState } from "./error-state";
import { expectRtl, expectTarget } from "./test-support";

describe("ErrorState", () => {
  it("is one line with the retry (FLOW-371)", () => {
    expectRtl();
    const { rerender } = render(<ErrorState offline onRetry={() => undefined} />);
    expect(screen.getByText("אין חיבור לאינטרנט.")).toBeInTheDocument();
    expectTarget(screen.getByRole("button", { name: "נסו שוב" }));
    expect(screen.getByRole("button", { name: "נסו שוב" })).toHaveClass("ui-btn-link");
    rerender(<ErrorState offline={false} onRetry={() => undefined} />);
    expect(screen.getByText("לא הצלחנו לטעון.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).toBeNull();
  });
});
