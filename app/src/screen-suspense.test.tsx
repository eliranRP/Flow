import { render, screen } from "@testing-library/react";
import { lazy } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreenSuspense } from "./screen-suspense";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ScreenSuspense (FLOW-804)", () => {
  it("shows the screen once its code loads", async () => {
    const Screen = lazy(() => Promise.resolve({ default: () => <h1>מסך</h1> }));
    render(
      <ScreenSuspense>
        <Screen />
      </ScreenSuspense>,
    );
    expect(await screen.findByRole("heading", { name: "מסך" })).toBeInTheDocument();
  });

  it("shows the load error with a retry when a screen's code fails to load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Screen = lazy(() => Promise.reject(new Error("chunk failed")));
    render(
      <ScreenSuspense>
        <Screen />
      </ScreenSuspense>,
    );
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.getByText(/לא הצלחנו לטעון|אין חיבור לאינטרנט/)).toBeInTheDocument();
  });
});
