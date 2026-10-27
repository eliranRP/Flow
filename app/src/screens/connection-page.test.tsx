import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { RolePreview } from "../use-is-viewer";
import { ConnectionDetailPage } from "./connection-pages";
import { MercuryConnectionRoute } from "./mercury-connection-screen";

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: () => Promise.resolve({ data: null, error: null }),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  }),
}));

const SUMIT_PROBLEM = "המפתח הקודם הפסיק לעבוד";

describe("SUMIT connection page (FLOW-512)", () => {
  it("never greys out חיבור: a tap with something missing says what is missing (decision 0223)", () => {
    renderWithProviders(<ConnectionDetailPage provider="sumit" sample={{ state: "new" }} />, { route: "/settings/connections/sumit" });
    const connect = screen.getByRole("button", { name: "חיבור" });
    expect(connect).toBeEnabled();
    fireEvent.change(screen.getByLabelText("מספר חברה"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("מפתח API"), { target: { value: "abcdefgh" } });
    fireEvent.click(connect);
    expect(screen.getByText("צריך מספר חברה (6 ספרות לפחות) ומפתח מלא")).toBeInTheDocument();
    // Typing clears the note; a full company number and key send nothing missing.
    fireEvent.change(screen.getByLabelText("מספר חברה"), { target: { value: "1234567" } });
    expect(screen.queryByText("צריך מספר חברה (6 ספרות לפחות) ומפתח מלא")).not.toBeInTheDocument();
    expect(connect).toBeEnabled();
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

  it("shows the facts and the three actions when connected, and disconnects at once with ביטול (decision 0223)", async () => {
    renderWithProviders(<ConnectionDetailPage provider="sumit" sample={{ state: "connected", companyId: "1234567", lastSync: "היום, 06:05" }} />, { route: "/settings/connections/sumit" });
    expect(screen.getByText("מחובר")).toBeInTheDocument();
    expect(screen.getByText("היום, 06:05")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "רענון עכשיו" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "החלפת מפתח API" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ניתוק" }));
    // No question first: the page shows the form at once and the toast offers ביטול.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("מפתח API")).toBeInTheDocument();
    expect(await screen.findByText("SUMIT נותק. מה שכבר נכנס נשמר")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(await screen.findByText("מחובר")).toBeInTheDocument();
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

describe("Mercury connection page (FLOW-512, FLOW-938)", () => {
  it("asks only for the key: no company number, and no import date (that comes after the key)", () => {
    renderWithProviders(<MercuryConnectionRoute sample={{ connections: [] }} />, { route: "/settings/connections/mercury" });
    expect(screen.queryByRole("radio", { name: "מההתחלה" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("מספר חברה")).not.toBeInTheDocument();
    expect(screen.getByLabelText("מפתח API")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("מפתח API"), { target: { value: "mercury-key-123" } });
    expect(screen.getByRole("button", { name: "חיבור" })).toBeEnabled();
  });
});
