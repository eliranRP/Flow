import { act } from "@testing-library/react";
import { expect, vi } from "vitest";

function pixels(raw: string): number {
  if (raw.startsWith("var(")) {
    const name = raw.slice(4, -1).trim();
    return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  }
  return Number.parseFloat(raw);
}

/**
 * The drawn box can be 32 or 36. The hit area is the ::after inset, driven by --hit-block.
 * jsdom does not compute pseudo-elements, so the same custom property is read off the element.
 */
function stylesheetHit(el: HTMLElement, box: number): number {
  const style = getComputedStyle(el);
  if (style.overflow === "hidden" || style.overflow === "clip") return 0;
  const declared = pixels(style.getPropertyValue("--hit-block"));
  if (!declared || declared <= box) return 0;
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes("::after")) continue;
      const inset = rule.style.getPropertyValue("inset-block");
      if (!inset.includes("--hit-block")) continue;
      const matches = rule.selectorText.split(",").some((selector) => {
        const base = selector.trim().replace(/::after$/, "").trim();
        return base.length > 0 && el.matches(base);
      });
      if (matches) return declared;
    }
  }
  return 0;
}

export function expectTarget(el: HTMLElement, min = 44) {
  const style = getComputedStyle(el);
  const logical = Math.max(
    pixels(style.getPropertyValue("min-block-size")) || 0,
    pixels(style.getPropertyValue("block-size")) || 0,
  );
  const box = Math.max(pixels(style.minHeight) || 0, pixels(style.height) || 0, logical);
  let fromAfter = 0;
  try {
    const after = getComputedStyle(el, "::after");
    const inset = after.getPropertyValue("inset-block");
    const literal = /(-?[\d.]+)px/.exec(inset);
    if (literal && after.content !== "none" && after.content !== "") {
      fromAfter = box + Math.abs(Number(literal[1])) * 2;
    }
  } catch {
    fromAfter = 0;
  }
  const extended = fromAfter > 0 ? fromAfter : stylesheetHit(el, box);
  expect(Math.max(box, extended)).toBeGreaterThanOrEqual(min);
}

function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function matchingDeclaration(el: HTMLElement, prop: string): string {
  const name = kebab(prop);
  let specified = "";
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const value = rule.style.getPropertyValue(name) || (name === "background-color" ? rule.style.getPropertyValue("background") : "");
      if (!value.includes("var(")) continue;
      const hit = rule.selectorText.split(",").some((selector) => {
        try {
          return el.matches(selector.trim());
        } catch {
          return false;
        }
      });
      if (hit) specified = value;
    }
  }
  return specified;
}

function resolveVars(value: string): string {
  const root = getComputedStyle(document.documentElement);
  return value.replace(/var\((--[\w-]+)\)/g, (_match, name: string) => root.getPropertyValue(name).trim());
}

function paintValue(el: HTMLElement, prop: string): string {
  const specified = matchingDeclaration(el, prop);
  if (specified) return resolveVars(specified);
  return resolveVars(getComputedStyle(el).getPropertyValue(kebab(prop)).trim());
}

/** The element's own paint must change between the light and dark themes. */
export function expectThemePaint(el: HTMLElement, prop = "color") {
  expect(el.isConnected).toBe(true);
  document.documentElement.dataset.theme = "light";
  const light = paintValue(el, prop);
  document.documentElement.dataset.theme = "dark";
  const dark = paintValue(el, prop);
  expect(light).not.toBe("");
  expect(dark).not.toBe("");
  expect(light).not.toBe(dark);
}

export function expectRtl() {
  expect(document.documentElement.dir).toBe("rtl");
  expect(document.documentElement.lang).toBe("he");
}

type Watch = { callback: IntersectionObserverCallback; targets: Set<Element>; self: IntersectionObserver };

/**
 * An IntersectionObserver that answers as the browser does for the compact bar's mark: a node reports at
 * once when observed, at the top of the page unless `page.scrolled` says otherwise, and `settle()` reports
 * every observed node again. A node no longer in the page reads as a zero rect, as WebKit and Chromium
 * report it, which is above the bar. Undo it with `vi.unstubAllGlobals()`.
 */
export function stubPageObserver(): { page: { scrolled: boolean }; settle: () => void } {
  const watches = new Set<Watch>();
  const page = { scrolled: false };
  const entry = (target: Element) => {
    const attached = target.isConnected;
    const top = attached ? (page.scrolled ? -20 : 120) : 0;
    return { target, isIntersecting: attached && !page.scrolled, boundingClientRect: { top } } as unknown as IntersectionObserverEntry;
  };
  vi.stubGlobal("IntersectionObserver", class {
    private readonly watch: Watch;
    constructor(callback: IntersectionObserverCallback) {
      this.watch = { callback, targets: new Set(), self: this as unknown as IntersectionObserver };
      watches.add(this.watch);
    }
    observe(target: Element) {
      this.watch.targets.add(target);
      this.watch.callback([entry(target)], this.watch.self);
    }
    unobserve(target: Element) {
      this.watch.targets.delete(target);
    }
    disconnect() {
      watches.delete(this.watch);
    }
    takeRecords() {
      return [];
    }
  });
  return {
    page,
    settle: () => {
      act(() => {
        for (const watch of [...watches]) for (const target of watch.targets) watch.callback([entry(target)], watch.self);
      });
    },
  };
}
