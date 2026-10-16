import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConnectorRow } from "./connector-row";

describe("ConnectorRow focus and retry (FLOW-512, ported from sumit-row.test.tsx)", () => {
  it("runs the retry from the error row's ניסיון חוזר link", () => {
    const onRetry = vi.fn();
    render(
      <ConnectorRow
        title="SUMIT"
        icon={null}
        state="error"
        retry={{ hint: "לא הצלחנו לטעון", label: "ניסיון חוזר: SUMIT", onRetry }}
      />,
    );
    expect(screen.getByText("לא הצלחנו לטעון")).toHaveAttribute("role", "status");
    fireEvent.click(screen.getByRole("button", { name: "ניסיון חוזר: SUMIT" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("hands the retry button and the ready row to their refs, so a parent can return focus", () => {
    const retryRef = createRef<HTMLButtonElement>();
    const rowRef = createRef<HTMLButtonElement>();
    const { rerender } = render(
      <ConnectorRow
        title="SUMIT"
        icon={null}
        state="error"
        retry={{ hint: "שגיאה", label: "ניסיון חוזר: SUMIT", retryRef, onRetry: vi.fn() }}
        rowRef={rowRef}
      />,
    );
    expect(retryRef.current).toBe(screen.getByRole("button", { name: "ניסיון חוזר: SUMIT" }));
    rerender(<ConnectorRow title="SUMIT" icon={null} state="ready" hint="מחובר" onOpen={vi.fn()} rowRef={rowRef} />);
    expect(rowRef.current).toBe(screen.getByRole("button", { name: /SUMIT/ }));
    rowRef.current?.focus();
    expect(screen.getByRole("button", { name: /SUMIT/ })).toHaveFocus();
  });
});
