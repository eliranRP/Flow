import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

type Control = {
  index: number;
  name: string;
  href: string;
  current: string;
  checked: string;
  type: string;
  tag: string;
};

async function describeControls(page: Page): Promise<Control[]> {
  return page.locator("a[href], button, input, textarea").evaluateAll((nodes) => {
    return nodes.flatMap((node, index) => {
      const el = node as HTMLElement;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return [];
      if (el.getAttribute("aria-hidden") === "true") return [];
      const input = el as HTMLInputElement;
      const disabled = input.disabled || el.getAttribute("aria-disabled") === "true";
      const rawType = (el as { type?: unknown }).type;
      const type = typeof rawType === "string" ? rawType : "";
      if (disabled || type === "hidden") return [];
      const name = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim();
      return [{
        index,
        name,
        href: el.getAttribute("href") ?? "",
        current: el.getAttribute("aria-current") ?? "",
        checked: el.getAttribute("aria-checked") ?? el.getAttribute("aria-pressed") ?? "",
        type,
        tag: el.tagName.toLowerCase(),
      }];
    });
  });
}

async function fingerprint(page: Page) {
  return page.evaluate(() => ({
    url: location.pathname + location.search,
    dialogs: document.querySelectorAll("[role='dialog']").length,
    toast: document.querySelector(".ui-toast")?.textContent ?? "",
    checked: [...document.querySelectorAll("[aria-checked],[aria-pressed],[aria-selected],input[type='checkbox'],input[type='radio']")].map((node) => {
      if (node instanceof HTMLInputElement && (node.type === "checkbox" || node.type === "radio")) return node.checked ? "1" : "0";
      return node.getAttribute("aria-checked") ?? node.getAttribute("aria-pressed") ?? node.getAttribute("aria-selected");
    }).join(","),
    expanded: [...document.querySelectorAll("[aria-expanded]")].map((node) => node.getAttribute("aria-expanded")).join(","),
    text: document.body.innerText,
  }));
}

/** Opens the route once the dev server has loaded every lazy screen (FLOW-804) and React has drawn it. */
async function gotoSettled(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.screensLoaded === "1");
  // A route that opens a sheet on load: wait until it is open, or a control under it reads as
  // reachable and the sheet covers it mid-click (main went red on /add after #360).
  if (sheetOnLoad.has(url)) await page.locator("[data-vaul-drawer][data-state='open']").first().waitFor({ timeout: 10_000 });
  // Every route: wait until nothing is moving, so a click never lands mid-transition (main went red
  // on the tab bar at /settings/categories). Finite animations only: a skeleton shine or a spinner loops forever.
  await page.waitForFunction(() => document.getAnimations().every((animation) =>
    animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity), undefined, { timeout: 10_000 });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  }));
}

/** A control list's shape: the sweep finds each control again by its place in this list. */
function shape(controls: Control[]): string[] {
  return controls.map((control) => `${String(control.index)} ${control.tag} ${control.name} ${control.href}`);
}

/**
 * The controls once the route's screen has drawn. A screen loads on demand and renders nothing
 * until it does (screen-suspense.tsx), so a fast load can show only the tab bar at first: read until
 * two reads 250 ms apart agree.
 */
async function settledControls(page: Page): Promise<Control[]> {
  let last = await describeControls(page);
  for (let tries = 0; tries < 40; tries += 1) {
    await page.waitForTimeout(250);
    const next = await describeControls(page);
    if (JSON.stringify(shape(next)) === JSON.stringify(shape(last))) return next;
    last = next;
  }
  return last;
}

function hitTarget(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const rect = el.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, Math.max(rect.height - 1, 0)));
  if (!hit) return false;
  const label = el.closest("label");
  return el === hit || el.contains(hit) || hit.contains(el) || (label != null && label === hit.closest("label"));
}

function sameUrl(href: string, current: string) {
  if (href === "" || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("http")) return false;
  const next = new URL(href, current);
  const here = new URL(current);
  return next.pathname === here.pathname && next.search === here.search;
}


/** These routes open a sheet on load, so controls under the scrim are covered. */
// The change fixture draws the tab bar under its sheet like the real route (FLOW-334), so its tabs are covered too.
const sheetOnLoad = new Set(["/add?preview=1", "/review/change?preview=1", "/e2e/change?preview=1"]);

/** Each sweep spec's routes and the files they draw (scripts/gate-scope.mjs --sweep reads them too). */
const sweeps = (JSON.parse(readFileSync(new URL("./spec-sources.json", import.meta.url), "utf8")) as {
  sweeps: { routes: Record<string, Record<string, string[]>> };
}).sweeps.routes;

/**
 * Registers one test per route of `spec` in spec-sources.json: every enabled link, button and field
 * on it must do something when used (navigate, open, toggle, focus, or show a message). The specs
 * split the routes by screen (FLOW-813), and the pre-push gate names the routes whose files its
 * change reaches in FLOW_SWEEP_ROUTES, one per line; without it (main) every route is swept.
 */
export function sweepControls(spec: string): void {
  test.use({ viewport: { width: 390, height: 844 } });
  test.describe.configure({ mode: "parallel" });
  const urls = Object.keys(sweeps[spec] ?? {});
  if (urls.length === 0) throw new Error(`${spec} has no routes under sweeps in spec-sources.json`);
  const only = (process.env.FLOW_SWEEP_ROUTES ?? "").split("\n").filter(Boolean);
  for (const url of only.length > 0 ? urls.filter((route) => only.includes(route)) : urls) {
    test(`no enabled control is a no-op on ${url}`, async ({ page }) => {
      test.setTimeout(180_000);
      await gotoSettled(page, url);
      const found = await settledControls(page);
      // Every control below starts from this same fresh page, so the checks that read only the
      // control's description run before the reload.
      const here = page.url();
      const failures: string[] = [];
      let skipped = 0;
      for (const control of found) {
        if (control.name.includes("המשך עם Google")) continue;
        if (control.href.startsWith("mailto:") || control.href.startsWith("tel:") || control.href.startsWith("http")) continue;
        if (control.tag === "a" && sameUrl(control.href, here) && control.current !== "page") {
          failures.push(`${control.name || control.tag} links to the current page`);
          continue;
        }
        if (control.tag === "a" && control.current === "page" && sameUrl(control.href, here)) continue;
        const field = (control.tag === "input" || control.tag === "textarea") && control.type !== "checkbox" && control.type !== "radio";
        if (!field && control.checked === "true") continue;
        await gotoSettled(page, url);
        // The same controls as the first look, so nth() below is this control and not its neighbour.
        await expect.poll(async () => shape(await describeControls(page)), { timeout: 10_000 }).toEqual(shape(found));
        const target = page.locator("a[href], button, input, textarea").nth(control.index);
        if (field) {
          await target.click();
          const focused = await target.evaluate((node) => document.activeElement === node);
          if (!focused) failures.push(`${control.name || "field"} did not focus`);
          continue;
        }
        await target.scrollIntoViewIfNeeded();
        let reachable = await target.evaluate(hitTarget);
        if (!reachable) {
          await target.evaluate((el) => {
            el.scrollIntoView({ block: "center", inline: "nearest" });
          });
          reachable = await target.evaluate(hitTarget);
        }
        if (!reachable) {
          const covered = await target.evaluate((el) => {
            const sheet = document.querySelector("[data-vaul-drawer][data-state='open']");
            return sheet != null && !sheet.contains(el);
          });
          if (covered) {
            skipped += 1;
            continue;
          }
          failures.push(`${control.name || control.tag} at ${url} stayed unclickable`);
          continue;
        }
        const before = await fingerprint(page);
        try {
          await target.click({ timeout: 2_000 });
        } catch {
          failures.push(`${control.name || control.tag} at ${url} could not be clicked`);
          continue;
        }
        try {
          // A loaded runner can take a few seconds to answer a tap; a real no-op stays the same throughout.
          await expect.poll(() => fingerprint(page), { timeout: 5_000 }).not.toEqual(before);
        } catch {
          const invalid = await page.evaluate(() => {
            const field = document.activeElement;
            return field instanceof HTMLInputElement && field.validationMessage !== "";
          });
          if (!invalid) failures.push(`${control.name || control.tag} at ${url} did nothing`);
        }
      }
      console.log(`no-op sweep ${url}: skipped ${String(skipped)} covered controls`);
      if (!sheetOnLoad.has(url)) expect(skipped).toBe(0);
      expect(failures).toEqual([]);
    });
  }
}
