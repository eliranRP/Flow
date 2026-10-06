import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InstallScreen } from "./install-screen";
import { ToastProvider } from "./toast";

function renderInstall(mode: Parameters<typeof InstallScreen>[0]["mode"], onDismiss = () => undefined, onInstall?: () => void) {
  return render(
    <ToastProvider>
      <InstallScreen mode={mode} onDismiss={onDismiss} onInstall={onInstall} />
    </ToastProvider>,
  );
}

describe("InstallScreen", () => {
  it("shows the Android prompt actions and calls the saved install", () => {
    const onInstall = vi.fn();
    renderInstall("android-prompt", () => undefined, onInstall);
    expect(screen.getByRole("heading", { name: "התקנת Flow" })).toBeInTheDocument();
    expect(screen.getByText("פתיחה במגע אחד")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "התקנה" }));
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it("replaces the Android button with three steps when the prompt is missing", () => {
    const onDismiss = vi.fn();
    renderInstall("android-steps", onDismiss);
    expect(screen.getByRole("list").children).toHaveLength(3);
    expect(screen.getByText("⋮")).toBeInTheDocument();
    expect(screen.getByText("בוחרים ״הוספה למסך הבית״")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "התקנה" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "הבנתי" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("shows the iOS 26 rows on iPhone", () => {
    renderInstall("iphone");
    expect(screen.getByRole("list").children).toHaveLength(3);
    expect(screen.getByText("•••")).toBeInTheDocument();
    expect(screen.getByText("שיתוף ואז הוספה למסך הבית")).toBeInTheDocument();
    expect(screen.getByText("מקישים הוספה")).toBeInTheDocument();
    expect(screen.queryByText("ההתקנה באייפון עובדת רק מספארי.")).not.toBeInTheDocument();
    expect(screen.queryByText("פותחים את הקישור הזה בספארי")).not.toBeInTheDocument();
  });

  it("uses the same iOS 26 rows on iPad", () => {
    renderInstall("ipad");
    expect(screen.getByText("שיתוף ואז הוספה למסך הבית")).toBeInTheDocument();
    expect(screen.queryByText("כפתור השיתוף נמצא למעלה")).not.toBeInTheDocument();
  });

  it("uses the same iOS 26 rows in another iPhone browser", () => {
    const onDismiss = vi.fn();
    renderInstall("iphone-other", onDismiss);
    expect(screen.getByRole("list").children).toHaveLength(3);
    expect(screen.getByText("•••")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "העתקת קישור" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "הבנתי" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
