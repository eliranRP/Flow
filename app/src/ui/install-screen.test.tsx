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
    expect(screen.getByText(/מקישים על ⋮/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "התקנה" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "הבנתי" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("keeps the Safari share label with its icon", () => {
    renderInstall("iphone");
    const unit = screen.getByText("״שיתוף״").parentElement;
    expect(unit).toHaveClass("ui-install-unit");
    expect(screen.getByText("כפתור השיתוף נמצא למטה")).toBeInTheDocument();
  });

  it("points an iPad at the top share button", () => {
    renderInstall("ipad");
    expect(screen.getByText("כפתור השיתוף נמצא למעלה")).toBeInTheDocument();
  });

  it("copies the link from a non-Safari iPhone", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderInstall("iphone-other");
    expect(screen.getByText("ההתקנה באייפון עובדת רק מספארי.")).toBeInTheDocument();
    expect(screen.getByRole("list").children).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "העתקת קישור" }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(await screen.findByText("הקישור הועתק")).toBeInTheDocument();
  });
});
