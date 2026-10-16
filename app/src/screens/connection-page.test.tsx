import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { RolePreview } from "../use-is-viewer";
import { ConnectionDetailPage } from "./connection-pages";

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: () => Promise.resolve({ data: null, error: null }),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  }),
}));

const SUMIT_PROBLEM = "המפתח הקודם הפסיק לעבוד";

describe("SUMIT connection page (FLOW-512)", () => {
  it("keeps the connect button off until the company number and the key have a shape", () => {
    renderWithProviders(<ConnectionDetailPage provider="sumit" sample={{ state: "new" }} />, { route: "/settings/connections/sumit" });
    const connect = screen.getByRole("button", { name: "חיבור" });
    expect(connect).toBeDisabled();
    fireEvent.change(screen.getByLabelText("מספר חברה"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("מפתח API"), { target: { value: "abcdefgh" } });
    expect(connect).toBeDisabled();
    fireEvent.change(screen.getByLabelText("מספר חברה"), { target: { value: "1234567" } });
    expect(connect).toBeEnabled();
    fireEvent.change(screen.getByLabelText("מפתח API"), { target: { value: "abc" } });
    expect(connect).toBeDisabled();
  });

  it("shows the connecting label while the connect is in flight", () => {
    renderWithProviders(<ConnectionDetailPage provider="sumit" sample={{ state: "new", companyId: "1234567", busy: true }} />, { route: "/settings/connections/sumit" });
    expect(screen.getByRole("button", { name: "מתחבר…" })).toBeInTheDocument();
  });

  it("puts the problem box and the reconnect label only on a broken connection", () => {
    const { unmount } = renderWithProviders(<ConnectionDetailPage provider="sumit" sample={{ state: "new" }} />, { route: "/settings/connections/sumit" });
    expect(screen.queryByText(new RegExp(SUMIT_PROBLEM))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "חיבור" })).toBeInTheDocument();
    unmount();

    renderWithProviders(<ConnectionDetailPage provider="sumit" sample={{ state: "problem", companyId: "1234567" }} />, { route: "/settings/connections/sumit" });
    expect(screen.getByText(new RegExp(SUMIT_PROBLEM))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "חיבור מחדש" })).toBeInTheDocument();
  });

  it("shows the facts and the three actions when connected, and asks before disconnecting", () => {
    renderWithProviders(<ConnectionDetailPage provider="sumit" sample={{ state: "connected", companyId: "1234567", lastSync: "היום, 06:05" }} />, { route: "/settings/connections/sumit" });
    expect(screen.getByText("מחובר")).toBeInTheDocument();
    expect(screen.getByText("היום, 06:05")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "רענון עכשיו" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "החלפת מפתח API" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ניתוק" }));
    const dialog = screen.getByRole("dialog", { name: "לנתק את SUMIT?" });
    expect(within(dialog).getByText("המפתח נמחק. הספרים שכבר ירדו נשארים.")).toBeInTheDocument();
  });

  it("gives an editor no connect form and says only the owner connects", () => {
    renderWithProviders(
      <RolePreview role="editor">
        <ConnectionDetailPage provider="sumit" sample={{ state: "new" }} />
      </RolePreview>,
      { route: "/settings/connections/sumit" },
    );
    expect(screen.getByText("רק הבעלים יכולים לחבר.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "חיבור" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("מפתח API")).not.toBeInTheDocument();
  });
});

describe("Mercury connection page (FLOW-512)", () => {
  it("asks only for the key, with no company number", () => {
    renderWithProviders(<ConnectionDetailPage provider="mercury" sample={{ state: "new" }} />, { route: "/settings/connections/mercury" });
    expect(screen.queryByLabelText("מספר חברה")).not.toBeInTheDocument();
    expect(screen.getByLabelText("מפתח API")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("מפתח API"), { target: { value: "mercury-key-123" } });
    expect(screen.getByRole("button", { name: "חיבור" })).toBeEnabled();
  });
});
