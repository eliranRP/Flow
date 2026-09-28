import { expect } from "vitest";

function pixels(raw: string): number {
  if (raw.startsWith("var(")) {
    const name = raw.slice(4, -1).trim();
    return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  }
  return Number.parseFloat(raw);
}

/** jsdom leaves custom properties unresolved on used values, so read the token. */
export function expectTarget(el: HTMLElement, min = 44) {
  const style = getComputedStyle(el);
  const value = Math.max(pixels(style.minHeight) || 0, pixels(style.height) || 0);
  expect(value).toBeGreaterThanOrEqual(min);
}

export function expectThemePaint(el: HTMLElement, _prop?: string) {
  expect(el.isConnected).toBe(true);
  document.documentElement.dataset.theme = "light";
  const light = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
  document.documentElement.dataset.theme = "dark";
  const dark = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
  expect(light).toBe("#7B3FE4");
  expect(dark).toBe("#B894FF");
}

export function expectRtl() {
  expect(document.documentElement.dir).toBe("rtl");
  expect(document.documentElement.lang).toBe("he");
}
