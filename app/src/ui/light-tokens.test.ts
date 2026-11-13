// @vitest-environment node
// FLOW-372: the light token values (the Design guide's "Light theme" table), the AA contrast of the
// text and accent pairs on the light background and surface, and the toast inversion.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokensCss = readFileSync(new URL("../../../design/system/implementation-tokens.css", import.meta.url), "utf8");

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The body of the first block that starts with `head` (e.g. ":root {"), brace-matched. */
function blockBody(css: string, head: string): string {
  const start = css.indexOf(head);
  if (start < 0) throw new Error(`no block starting "${head}"`);
  let depth = 0;
  for (let i = start + head.length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start + head.length, i);
    }
  }
  throw new Error(`unclosed block "${head}"`);
}

/** Custom property declarations in a block: name -> value. */
function declarations(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, name = "", value = ""] of stripComments(body).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(name, value.trim());
  }
  return map;
}

const light = declarations(blockBody(tokensCss, ":root {"));
const dark = declarations(blockBody(tokensCss, ':root[data-theme="dark"] {'));

/** WCAG 2 relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function hexOf(map: Map<string, string>, name: string): string {
  const value = map.get(name);
  if (!value || !/^#[0-9A-F]{6}$/i.test(value)) throw new Error(`${name} is not a #RRGGBB value in the light block`);
  return value;
}

describe("light text and accent on the light background and surface (WCAG AA 4.5:1)", () => {
  const backgrounds = ["--color-bg", "--color-surface"];
  const foregrounds = ["--color-text", "--color-text-secondary", "--color-text-muted", "--color-accent", "--color-accent-text"];

  for (const fg of foregrounds) {
    for (const bg of backgrounds) {
      it(`${fg} on ${bg} reaches 4.5:1`, () => {
        const ratio = contrast(hexOf(light, fg), hexOf(light, bg));
        expect(ratio, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

// FLOW-976: a field draws on --color-raised, so its text and its prompt are checked on that fill too,
// in light and dark. The prompt stays lighter than secondary text, so it does not read as a value.
// FLOW-980: muted text (hints, dates, an inner box's labels) sits on the raised fill too.
describe("a field's text and prompt on the raised fill and the surface (WCAG AA 4.5:1)", () => {
  const backgrounds = ["--color-raised", "--color-surface"];
  const foregrounds = ["--color-text", "--color-text-secondary", "--color-text-muted", "--color-placeholder"];

  for (const [theme, map] of [["light", light], ["dark", dark]] as const) {
    for (const fg of foregrounds) {
      for (const bg of backgrounds) {
        it(`${theme}: ${fg} on ${bg} reaches 4.5:1`, () => {
          const ratio = contrast(hexOf(map, fg), hexOf(map, bg));
          expect(ratio, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    it(`${theme}: the prompt and muted text are lighter than secondary text on the raised fill`, () => {
      const raised = hexOf(map, "--color-raised");
      const secondary = contrast(hexOf(map, "--color-text-secondary"), raised);
      expect(contrast(hexOf(map, "--color-placeholder"), raised)).toBeLessThan(secondary);
      expect(contrast(hexOf(map, "--color-text-muted"), raised)).toBeLessThan(secondary);
    });
  }
});

describe("light values from the Design guide's Light theme table", () => {
  const board: Record<string, string> = {
    "--color-bg": "#F6F4FA",
    "--color-surface": "#FFFFFF",
    "--color-raised": "#F1EEF6",
    "--color-skeleton": "#F1EEF6",
    "--color-tint": "#EEE6FD",
    "--color-track": "#E7E2F0",
    "--color-line": "#E7E2F0",
    "--color-outline-secondary": "#DAD3E6",
    "--color-tint-strong": "#D9CBF6",
    "--color-text": "#1D1728",
    "--color-text-secondary": "#5B536E",
    "--color-text-muted": "#6E6682",
    "--color-accent": "#6C2ED6",
    "--color-accent-text": "#6C2ED6",
    "--color-on-accent": "#F6F4FA",
    "--color-income": "#1A8048",
    "--color-good": "#1A8048",
    "--color-signal": "#D23B2F",
    "--color-signal-soft": "#B9503F",
    "--color-toast-text": "#F6F4FA",
  };

  for (const [name, value] of Object.entries(board)) {
    it(`${name} is ${value} in light`, () => {
      expect(hexOf(light, name)).toBe(value);
    });
  }

  it("keeps the shadow at rgba(40,20,90,.12) in light", () => {
    expect(light.get("--shadow-lg")).toBe("0 8px 24px rgba(40, 20, 90, 0.12)");
    expect(light.get("--shadow-pill")).toBe("var(--shadow-lg)");
    expect(light.get("--shadow-toast")).toBe("var(--shadow-lg)");
  });

  it("keeps the band colour the same in both themes", () => {
    expect(light.get("--color-band")).toBe("#7B3FE4");
    expect(dark.get("--color-band")).toBe("#7B3FE4");
  });
});

describe("toasts invert", () => {
  it("a light theme toast is dark, with light text", () => {
    expect(luminance(hexOf(light, "--color-toast-bg"))).toBeLessThan(0.1);
    expect(luminance(hexOf(light, "--color-toast-text"))).toBeGreaterThan(0.9);
  });

  it("a dark theme toast is light, with dark text", () => {
    expect(luminance(hexOf(dark, "--color-toast-bg"))).toBeGreaterThan(0.5);
    expect(luminance(hexOf(dark, "--color-toast-text"))).toBeLessThan(0.1);
  });
});

describe("dark values are unchanged by FLOW-372", () => {
  const darkMedia = declarations(blockBody(tokensCss, ':root:not([data-theme="light"]) {'));

  // Dark values before FLOW-372 for the tokens it does not own, plus tint-strong (the dark alias target).
  const pinned: Record<string, string> = {
    "--color-band": "#7B3FE4",
    "--color-band-past": "#5A2DB0",
    "--color-on-band": "#FFFFFF",
    "--color-band-chip": "#1E1929",
    "--color-band-pill": "#1E1929",
    "--color-pill-helps": "#4A4458",
    "--color-pill-hurts": "#C3302B",
    "--color-toast-bad": "#C3302B",
    "--color-tint-strong": "#382A5E",
  };
  for (const [name, value] of Object.entries(pinned)) {
    it(`${name} is ${value} in both dark blocks`, () => {
      expect(darkMedia.get(name)).toBe(value);
      expect(dark.get(name)).toBe(value);
    });
  }

  // The two intended changes: the new secondary outline aliases tint-strong, and the pill shadow is
  // declared in the dark blocks with the value it inherited before.
  it("the secondary outline is the dark tint-strong, in both dark blocks", () => {
    expect(darkMedia.get("--color-outline-secondary")).toBe("var(--color-tint-strong)");
    expect(dark.get("--color-outline-secondary")).toBe("var(--color-tint-strong)");
  });

  it("the floating-layer shadow keeps its dark value, in both dark blocks; pill and toast point at it", () => {
    for (const map of [darkMedia, dark]) {
      expect(map.get("--shadow-lg")).toBe("0 8px 24px rgba(0, 0, 0, 0.4)");
      expect(map.get("--shadow-pill")).toBe("var(--shadow-lg)");
      expect(map.get("--shadow-toast")).toBe("var(--shadow-lg)");
    }
  });
});

// FLOW-1180: the band's month pill names its month in white on its translucent white track over the band, in both
// themes. The track composited over the band keeps the white name at 4.5:1 (the 16% track was 4.2:1).
describe("the band's month pill (WCAG AA 4.5:1)", () => {
  /** A #RRGGBB of rgba(r, g, b, a) drawn over a #RRGGBB, in 8-bit channels as the browser paints it. */
  function over(rgba: string, under: string): string {
    const [r = 0, g = 0, b = 0, a = 0] = (/^rgba\(([^)]+)\)$/.exec(rgba)?.[1] ?? "").split(",").map(Number);
    const base = [1, 3, 5].map((at) => parseInt(under.slice(at, at + 2), 16));
    return `#${[r, g, b].map((c, i) => Math.round(c * a + (base[i] ?? 0) * (1 - a)).toString(16).padStart(2, "0")).join("")}`;
  }

  for (const [theme, map] of [["light", light], ["dark", dark]] as const) {
    it(`${theme}: --color-on-band on --band-pill-track over --color-band reaches 4.5:1`, () => {
      const track = map.get("--band-pill-track") ?? light.get("--band-pill-track") ?? "";
      const ratio = contrast(hexOf(map, "--color-on-band"), over(track, hexOf(map, "--color-band")));
      expect(ratio, `the month's name is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

// FLOW-1183: the five-token design system's two shadows and its 12px label.
describe("two shadows and a label size", () => {
  const darkMedia = declarations(blockBody(tokensCss, ':root:not([data-theme="light"]) {'));

  it("--shadow-sm is the subtle card shadow in light and the stronger one in both dark blocks", () => {
    expect(light.get("--shadow-sm")).toBe("0 1px 3px rgb(0 0 0 / 0.08), 0 1px 2px rgb(0 0 0 / 0.04)");
    for (const map of [darkMedia, dark]) {
      expect(map.get("--shadow-sm")).toBe("0 1px 3px rgb(0 0 0 / 0.5), 0 1px 2px rgb(0 0 0 / 0.35)");
    }
  });

  it("--type-label-size is 12px", () => {
    expect(light.get("--type-label-size")).toBe("12px");
  });
});

// FLOW-1183 (plan T6): a user who forces dark with [data-theme] must get every token the
// prefers-color-scheme dark block sets, or the forced mode silently falls back to the light value.
describe("the two dark blocks set the same custom properties", () => {
  const darkMedia = declarations(blockBody(tokensCss, ':root:not([data-theme="light"]) {'));

  it("every custom property in the prefers-color-scheme dark block is in the forced-dark block", () => {
    const missing = [...darkMedia.keys()].filter((name) => !dark.has(name));
    expect(missing).toEqual([]);
  });
});
