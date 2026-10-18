import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, FailureLine } from "./empty-state";
import { expectRtl, expectTarget } from "./test-support";

describe("EmptyState", () => {
  it("shows an icon, a title, one line, and at most one action", () => {
    expectRtl();
    render(<EmptyState icon={<span>◌</span>} title="עוד אין נתונים" body="הרווח יופיע כאן." action={<button type="button">חיבור</button>} />);
    expect(screen.getByText("עוד אין נתונים")).toHaveClass("t-name");
    expect(screen.getByText("הרווח יופיע כאן.")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

describe("FailureLine", () => {
  it("is one line with the retry (FLOW-371)", () => {
    expectRtl();
    const { rerender } = render(<FailureLine offline onRetry={() => undefined} />);
    expect(screen.getByText("אין חיבור לאינטרנט. שום דבר לא נמחק.")).toBeInTheDocument();
    expectTarget(screen.getByRole("button", { name: "נסו שוב" }));
    expect(screen.getByRole("button", { name: "נסו שוב" })).toHaveClass("ui-btn-link");
    rerender(<FailureLine offline={false} onRetry={() => undefined} />);
    expect(screen.getByText("לא הצלחנו לטעון.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).toBeNull();
  });

  it("calls onRetry once per press", () => {
    const onRetry = vi.fn();
    render(<FailureLine offline={false} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
