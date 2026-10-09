import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { iosBrowser } from "./install-copy";
import { InstallScreen } from "./install-screen";
import { ToastProvider } from "./toast";

type Props = Parameters<typeof InstallScreen>[0];

function renderInstall(mode: Props["mode"], onDismiss = () => undefined, onInstall?: () => void, browser?: Props["browser"]) {
  return render(
    <ToastProvider>
      <InstallScreen mode={mode} onDismiss={onDismiss} onInstall={onInstall} browser={browser} />
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

  it("shows Chrome's own share steps in Chrome on iPhone, not Safari's •••", () => {
    const onDismiss = vi.fn();
    renderInstall("iphone-other", onDismiss, undefined, "chrome");
    expect(screen.getByRole("list").children).toHaveLength(3);
    expect(screen.queryByText("•••")).not.toBeInTheDocument();
    expect(screen.getByText("מקישים על סמל השיתוף בשורת הכתובת")).toBeInTheDocument();
    expect(screen.getByText("בוחרים ״הוספה למסך הבית״")).toBeInTheDocument();
    expect(screen.queryByText("באייפון זה נעשה מספארי, בשלושה צעדים.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "העתקת קישור" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "הבנתי" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("shows Firefox's menu steps in Firefox on iPhone, and generic share steps elsewhere", () => {
    const { unmount } = renderInstall("iphone-other", undefined, undefined, "firefox");
    expect(screen.getByText("☰")).toBeInTheDocument();
    expect(screen.getByText("בוחרים שיתוף ואז ״הוספה למסך הבית״")).toBeInTheDocument();
    unmount();
    renderInstall("iphone-other", undefined, undefined, "other");
    expect(screen.getByText("מקישים על סמל השיתוף של הדפדפן")).toBeInTheDocument();
  });

  it("reads the iPhone browser from the user agent", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
    expect(iosBrowser(`${iphone} CriOS/129.0 Mobile/15E148 Safari/604.1`)).toBe("chrome");
    expect(iosBrowser(`${iphone} FxiOS/131.0 Mobile/15E148 Safari/605.1.15`)).toBe("firefox");
    expect(iosBrowser(`${iphone} EdgiOS/129.0 Mobile/15E148 Safari/605.1.15`)).toBe("other");
    expect(iosBrowser(`${iphone} Version/18.0 Mobile/15E148 Safari/604.1`)).toBe("safari");
  });
});
