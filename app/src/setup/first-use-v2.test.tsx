import { onlineManager } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SIGN_IN_OFFLINE, SIGN_IN_RETRY, SignInScreen } from "../screens/SignInScreen";
import { renderWithProviders } from "../test-render";
import { NEXT, PROJECT_ADD, PROJECT_NAME_EMPTY, PROJECT_NAME_SHORT, PROJECT_NAME_TAKEN, REVIEW_APPROVE, REVIEW_BEFORE } from "./copy";
import { projectNameProblem, StepProjects, StepReview } from "./steps";

// FLOW-976: First use v2. Sign-in says it is offline before the tap and keeps its help in the error;
// setup's buttons are never greyed out, and a tap that cannot act says why.

vi.mock("../auth", () => ({ useAuth: () => ({ status: "anon", session: null }) }));
vi.mock("../lib/supabase", () => ({ getSupabase: () => ({ auth: { signInWithOAuth: vi.fn() } }) }));

const step = { onDone: () => undefined, onStamp: () => undefined, onSkipStep: () => undefined, onSkipAll: () => undefined, onBack: () => undefined };

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("sign-in v2", () => {
  it("says it is offline before the tap", () => {
    onlineManager.setOnline(false);
    renderWithProviders(<SignInScreen />, { route: "/sign-in" });
    expect(screen.getByText(`אין חיבור · ${SIGN_IN_OFFLINE}`).closest("[role=status]")).not.toBeNull();
  });

  it("keeps the help link inside the error and names the retry", () => {
    renderWithProviders(<SignInScreen />, { route: "/sign-in?error=server_error" });
    const help = screen.getByRole("link", { name: "צריך עזרה בכניסה?" });
    expect(help.closest(".ui-notice")).not.toBeNull();
    expect(screen.getByRole("button", { name: SIGN_IN_RETRY })).toBeEnabled();
  });

  it("heads the page at the 32px title size", () => {
    renderWithProviders(<SignInScreen />, { route: "/sign-in" });
    expect(screen.getByRole("heading", { name: "כניסה או הרשמה" })).toHaveClass("t-title");
  });

  it("says it is offline when the page opens with no connection", () => {
    // React Query starts out online; the browser's flag is what knows.
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderWithProviders(<SignInScreen />, { route: "/sign-in" });
    expect(screen.getByText(`אין חיבור · ${SIGN_IN_OFFLINE}`)).toBeInTheDocument();
    expect(screen.queryByText("מתחבר מחדש…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "המשך עם Google" }));
    expect(screen.getByText("לא הצלחנו להתחבר")).toBeInTheDocument();
    onLine.mockRestore();
  });

  it("offline, a tap stays on the page and shows the failure with the retry", () => {
    onlineManager.setOnline(false);
    renderWithProviders(<SignInScreen />, { route: "/sign-in" });
    fireEvent.click(screen.getByRole("button", { name: "המשך עם Google" }));
    expect(screen.getByText("לא הצלחנו להתחבר")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SIGN_IN_RETRY })).toBeInTheDocument();
  });
});

describe("setup v2", () => {
  it("says why a project name cannot be added", () => {
    const taken = (name: string) => name === "Oak Ridge";
    expect(projectNameProblem("", taken)).toBe(PROJECT_NAME_EMPTY);
    expect(projectNameProblem("א", taken)).toBe(PROJECT_NAME_SHORT);
    expect(projectNameProblem("Oak Ridge", taken)).toBe(PROJECT_NAME_TAKEN);
    expect(projectNameProblem("Cedar St", taken)).toBeNull();
  });

  it("keeps הוספה enabled and puts the note in the field's own error line", async () => {
    renderWithProviders(<StepProjects {...step} companyId={null} bankConnected={false} existingNames={["Oak Ridge"]} />, { route: "/setup/3" });
    const add = screen.getByRole("button", { name: PROJECT_ADD });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    const note = await screen.findByText(PROJECT_NAME_EMPTY);
    expect(note).toHaveAttribute("aria-live", "polite");
    const field = screen.getByRole("textbox");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAttribute("aria-describedby", note.id);
    // A second tap clears the note and sets it again, so it is announced again.
    fireEvent.click(add);
    expect(screen.queryByText(PROJECT_NAME_EMPTY)).toBeNull();
    expect(await screen.findByText(PROJECT_NAME_EMPTY)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "Oak Ridge" } });
    expect(screen.queryByText(PROJECT_NAME_EMPTY)).toBeNull();
    fireEvent.click(add);
    expect(await screen.findByText(PROJECT_NAME_TAKEN)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "Cedar St" } });
    fireEvent.click(add);
    await waitFor(() => { expect(screen.getByText("Cedar St")).toBeInTheDocument(); });
    expect(field).not.toHaveAttribute("aria-invalid");
  });

  it("step 6's bottom button is never greyed out and takes focus to אישור", () => {
    renderWithProviders(<StepReview {...step} approved={false} />, { route: "/setup/6" });
    const before = screen.getByRole("button", { name: REVIEW_BEFORE });
    expect(before).toBeEnabled();
    fireEvent.click(before);
    const approve = screen.getByRole("button", { name: REVIEW_APPROVE });
    expect(approve).toHaveFocus();
    // The sample's אישור goes away on the tap; focus moves to the bottom המשך, not the page.
    fireEvent.click(approve);
    expect(screen.getByRole("button", { name: NEXT })).toHaveFocus();
  });
});
