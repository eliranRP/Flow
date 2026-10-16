// FLOW-372: the appearance choice. Each choice sets or clears data-theme, the saved choice is read
// back after a reload, and index.html applies it before the app runs (so the first paint is right).
import { runInThisContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import { applyThemeChoice, readThemeChoice, type ThemeChoice } from "./theme-store";

const inlineScript = /<script>([\s\S]*?)<\/script>/.exec(indexHtml)?.[1] ?? "";

/** Runs index.html's inline script in the test's global scope, as the browser does before the app. */
function runPrePaint(): void {
  runInThisContext(inlineScript);
}

function dataTheme(): string | null {
  return document.documentElement.getAttribute("data-theme");
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyThemeChoice", () => {
  it.each<[ThemeChoice, string | null]>([
    ["light", "light"],
    ["dark", "dark"],
    ["system", null],
  ])("the %s choice sets data-theme to %s (null: attribute removed)", (choice, attribute) => {
    document.documentElement.setAttribute("data-theme", "dark");
    applyThemeChoice(choice);
    expect(dataTheme()).toBe(attribute);
  });

  it("clears data-theme when the choice goes back to system", () => {
    applyThemeChoice("light");
    applyThemeChoice("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

describe("readThemeChoice", () => {
  it("defaults to system when nothing is saved", () => {
    expect(readThemeChoice()).toBe("system");
  });

  it("reads the saved light, dark and system choices under flow.theme", () => {
    for (const choice of ["light", "dark", "system"] as const) {
      localStorage.setItem("flow.theme", choice);
      expect(readThemeChoice()).toBe(choice);
    }
  });

  it("treats an unknown saved value as system", () => {
    localStorage.setItem("flow.theme", "sepia");
    expect(readThemeChoice()).toBe("system");
  });

  it("treats blocked storage as system instead of throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readThemeChoice()).toBe("system");
  });
});

describe("the pre-paint script in index.html", () => {
  it("is an inline script that sits before the app module", () => {
    expect(inlineScript).not.toBe("");
    expect(indexHtml.indexOf("<script>")).toBeLessThan(indexHtml.indexOf('type="module"'));
  });

  it("applies a saved light or dark choice before the app runs", () => {
    for (const choice of ["light", "dark"] as const) {
      localStorage.setItem("flow.theme", choice);
      runPrePaint();
      expect(dataTheme()).toBe(choice);
      document.documentElement.removeAttribute("data-theme");
    }
  });

  it("leaves data-theme off for system, for no saved choice, and for an unknown value", () => {
    runPrePaint();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    localStorage.setItem("flow.theme", "system");
    runPrePaint();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    localStorage.setItem("flow.theme", "sepia");
    runPrePaint();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("does not throw when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => {
      runPrePaint();
    }).not.toThrow();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("uses the same storage key as the store", () => {
    localStorage.setItem("flow.theme", "dark");
    expect(readThemeChoice()).toBe("dark");
    expect(inlineScript).toContain('"flow.theme"');
  });
});
