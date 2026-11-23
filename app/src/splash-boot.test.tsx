import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// FLOW-1277: when the splash plays. Each test loads the module afresh, since "once" is per page load.
async function load() {
  vi.resetModules();
  return import("./splash-boot");
}

function webdriver(value: boolean) {
  Object.defineProperty(navigator, "webdriver", { value, configurable: true });
}

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(navigator, "webdriver");
});

describe("shouldPlaySplash", () => {
  it("is false under an automated browser, true otherwise", async () => {
    const { shouldPlaySplash } = await load();
    expect(shouldPlaySplash({ webdriver: true })).toBe(false);
    expect(shouldPlaySplash({ webdriver: false })).toBe(true);
    expect(shouldPlaySplash({} as Navigator)).toBe(true);
  });
});

describe("startSplash", () => {
  it("never mounts under webdriver", async () => {
    webdriver(true);
    const { startSplash } = await load();
    expect(startSplash()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.body.children).toHaveLength(0);
  });

  it("puts the page-colour cover up at once, then the splash replaces it when its code arrives", async () => {
    webdriver(false);
    const { startSplash } = await load();
    expect(startSplash()).toBe(true);
    const cover = document.body.querySelector<HTMLElement>("div[aria-hidden]");
    expect(cover?.style.background).toBe("var(--color-bg)");
    expect(document.querySelector(".ui-splash")).toBeNull();
    await waitFor(() => {
      expect(document.querySelectorAll(".ui-splash")).toHaveLength(1);
    });
    expect(cover?.isConnected).toBe(false);
  });

  it("plays once per page load, then unmounts and takes its host out of the page", async () => {
    webdriver(false);
    const { startSplash } = await load();
    startSplash();
    await waitFor(() => {
      expect(document.querySelectorAll(".ui-splash")).toHaveLength(1);
    });
    expect(startSplash()).toBe(false);
    expect(document.querySelectorAll(".ui-splash")).toHaveLength(1);
    fireEvent.pointerDown(document.querySelector(".ui-splash") as HTMLElement);
    await waitFor(() => {
      expect(document.body.children).toHaveLength(0);
    });
    expect(startSplash()).toBe(false);
    expect(document.body.children).toHaveLength(0);
  });

  it("takes the cover down after the failsafe when the splash's code never arrives, and then shows nothing", async () => {
    webdriver(false);
    vi.useFakeTimers();
    vi.resetModules();
    vi.doMock("./ui/splash", () => new Promise(() => undefined));
    try {
      const { startSplash } = await import("./splash-boot");
      startSplash();
      expect(document.body.children).toHaveLength(1);
      vi.advanceTimersByTime(2999);
      expect(document.body.children).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(document.body.children).toHaveLength(0);
    } finally {
      vi.doUnmock("./ui/splash");
      vi.useRealTimers();
    }
  });

  it("leaves no cover and no host when the splash throws while drawing", async () => {
    webdriver(false);
    vi.resetModules();
    vi.doMock("./ui/splash", () => ({
      Splash: () => {
        throw new Error("draw failed");
      },
    }));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { startSplash } = await import("./splash-boot");
      startSplash();
      await waitFor(() => {
        expect(document.body.children).toHaveLength(0);
      });
    } finally {
      error.mockRestore();
      vi.doUnmock("./ui/splash");
    }
  });
});
