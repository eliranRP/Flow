import { type Browser, expect, test, type Locator, type Page } from "@playwright/test";
import { demoProject, demoUnpaid } from "../src/demo/model";
import { median, RUNS } from "./runs";
import { REVIEW_CARDS, stubBackend } from "./stub-backend";

/**
 * FLOW-830, decision 0180: a tap shows its result within 200 ms, even when the server is slow. The
 * write is answered after 1 s (page.route holds it, then hands it to the stub), so a control that
 * waits for the server shows its result a second late and fails here. A write answered with HTTP
 * 500 must roll back and toast ניסיון חוזר; the retry, with the route now answering, shows it again.
 * No CPU throttle: the limit is a UI response, not CPU-bound work, so it does not scale (FLOW-816).
 * Each tap takes the median of RUNS opens; every open must also see the result while the write is
 * still unanswered.
 */
const LIMIT_MS = 200;
const WRITE_MS = 1_000;
/**
 * Reduced motion: the design tokens drop every transition to 0 ms (the sheet's slide, the card swap), so
 * the time measured is the app's own answer to the tap, not an animation the design already times.
 */
const MOTION = { reducedMotion: "reduce" } as const;
const TXN_ID = demoProject("herzl")?.transactions[0]?.id ?? "";
/** A line with a category: the change sheet saves a project pick only when the line has one. */
const CATEGORIZED_TXN_ID = demoProject("herzl")?.transactions.find((line) => line.category != null)?.id ?? "";

/** The write the route holds: how many arrived, how many were answered, and whether it fails. */
type Gate = { arrived: number; answered: number; failing: boolean; failedAt: number | null };

function gate(): Gate {
  return { arrived: 0, answered: 0, failing: false, failedAt: null };
}

/** Holds each call of one write RPC for WRITE_MS. Then it fails with 500, or the stub answers it. */
async function slowWrite(page: Page, rpc: string, held: Gate) {
  await page.route(new RegExp(`/rest/v1/rpc/${rpc}(\\?|$)`), async (route) => {
    held.arrived += 1;
    await new Promise((resolve) => setTimeout(resolve, WRITE_MS));
    if (held.failing) {
      held.failedAt = Date.now();
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "internal server error", code: "XX000" }),
      });
    } else {
      await route.fallback();
    }
    held.answered += 1;
  });
}

type Tap = {
  name: string;
  rpc: string;
  path: string;
  /** Opens the screen and gets it to the tappable state. Not timed. */
  arrange: (page: Page) => Promise<void>;
  /** A pick before the timed press, when the press is a save (FLOW-831). Not timed. */
  choose?: (page: Page) => Promise<void>;
  /** The tap itself. Timed. */
  press: (page: Page) => Promise<void>;
  /** True once the result shows. Polled, and timed up to the first true. */
  shown: (page: Page) => Promise<boolean>;
};

async function visibleCount(locator: Locator): Promise<number> {
  return (await locator.isVisible()) ? 1 : 0;
}

/** The Hebrew labels the screens draw. */
const LABELS = {
  approve: "אישור",
  markPaid: "סימון כשולם",
  inCash: "נספר בתזרים",
  hide: "הסתרה",
  retry: "ניסיון חוזר",
} as const;

const unpaidRow = demoUnpaid()[0];
const unpaidName = unpaidRow?.customer_name ?? unpaidRow?.description ?? "";
const cashSwitch = (page: Page) => page.getByRole("switch", { name: LABELS.inCash });
/** The project the picker chose, read in arrange: the summary row names it once the pick is in. */
let chosenProject = "";

const taps: Tap[] = [
  {
    name: "approve a card on לאישור",
    rpc: "approve_review_item",
    path: "/review",
    arrange: async (page) => {
      await expect(page.getByText(REVIEW_CARDS[0], { exact: true })).toBeVisible({ timeout: 30_000 });
    },
    press: async (page) => {
      await page.getByRole("button", { name: LABELS.approve, exact: true }).tap();
    },
    shown: async (page) => (await visibleCount(page.getByText(REVIEW_CARDS[0], { exact: true }))) === 0,
  },
  {
    name: "mark an open invoice paid on Unpaid",
    rpc: "set_invoice_paid",
    path: "/unpaid",
    arrange: async (page) => {
      // FLOW-367: a row is a link to its invoice page, and the mark sits there, once.
      await page.getByRole("link", { name: new RegExp(escapeRe(unpaidName)) }).first().tap();
      await expect(page).toHaveURL(/\/unpaid\/[^/?]+/);
      // The list leaves the page as the invoice route paints; until it does, every row has its own mark button.
      await expect(page.getByRole("list", { name: "חשבוניות פתוחות" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: LABELS.markPaid, exact: true })).toBeVisible({ timeout: 30_000 });
    },
    press: async (page) => {
      await page.getByRole("button", { name: LABELS.markPaid, exact: true }).tap();
    },
    // The row's own state: it stays listed and its hint now reads the mark (the sync wait).
    shown: async (page) => (await visibleCount(page.getByText(/ממתין לסנכרון/).first())) === 1,
  },
  {
    // The demo book starts this switch on, so the tap turns it off. The result is the switch's checked state.
    name: "flip נספר בתזרים on a transaction",
    rpc: "set_transaction_cash",
    path: `/transactions/${TXN_ID}`,
    arrange: async (page) => {
      // FLOW-366: the switch sits in the "נספר ב" sheet, so open the row first.
      await page.getByRole("button", { name: /^נספר ב/ }).tap();
      await expect(cashSwitch(page)).toBeVisible({ timeout: 30_000 });
    },
    press: async (page) => {
      await cashSwitch(page).tap();
    },
    shown: async (page) => !(await cashSwitch(page).isChecked()),
  },
  {
    name: "hide a category",
    rpc: "set_category_hidden",
    path: "/settings/categories",
    arrange: async (page) => {
      await page.getByRole("button", { name: "עוד, חומרים" }).tap();
      await page.getByRole("dialog", { name: "חומרים" }).getByRole("button", { name: LABELS.hide, exact: true }).tap();
      await expect(page.getByRole("dialog", { name: "להסתיר את הקטגוריה?" })).toBeVisible({ timeout: 30_000 });
    },
    press: async (page) => {
      await page.getByRole("dialog", { name: "להסתיר את הקטגוריה?" }).getByRole("button", { name: LABELS.hide, exact: true }).tap();
    },
    // The row leaves the visible list (it moves to מוסתרות). includeHidden: the open dialog covers the list, and
    // a covered row still counts as on the list until the hide lands.
    shown: async (page) => (await page.getByRole("button", { name: "עוד, חומרים", exact: true, includeHidden: true }).count()) === 0,
  },
  {
    name: "pick another project on a transaction",
    rpc: "reassign_transaction",
    path: `/transactions/${CATEGORIZED_TXN_ID}`,
    arrange: async (page) => {
      await page.getByRole("button", { name: /^פרויקט/ }).first().tap();
      const picker = page.getByRole("dialog", { name: "בחירת פרויקט" });
      await expect(picker).toBeVisible({ timeout: 30_000 });
      chosenProject = (await picker.getByRole("radio", { checked: false }).first().textContent())?.trim() ?? "";
      expect(chosenProject).not.toBe("");
    },
    // A row tap only moves the check (FLOW-831); the timed tap is the pinned שמירה.
    choose: async (page) => {
      await page.getByRole("dialog", { name: "בחירת פרויקט" }).getByRole("radio", { name: chosenProject, exact: true }).tap();
    },
    press: async (page) => {
      await page.getByRole("dialog", { name: "בחירת פרויקט" }).getByRole("button", { name: "שמירה", exact: true }).tap();
    },
    // The שמירה closes the sheet; the transaction's project row then names the tapped project.
    shown: async (page) => (await visibleCount(page.getByRole("button", { name: new RegExp(`^פרויקט ${escapeRe(chosenProject)}`) }))) === 1,
  },
];

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One open: a fresh session, the screen arranged, the write held, then the timed tap. */
async function open(browser: Browser, tap: Tap) {
  const context = await browser.newContext(MOTION);
  const page = await context.newPage();
  const held = gate();
  await stubBackend(page);
  await slowWrite(page, tap.rpc, held);
  await page.goto(tap.path);
  await page.waitForLoadState("networkidle");
  await tap.arrange(page);
  await tap.choose?.(page);
  const start = Date.now();
  await tap.press(page);
  await expect.poll(() => tap.shown(page), { intervals: [10], timeout: 10_000 }).toBe(true);
  const ms = Date.now() - start;
  // The result shows while the write is still held: the tap did not wait for the server.
  const pending = held.arrived > 0 && held.answered === 0;
  await context.close();
  return { ms, pending };
}

for (const tap of taps) {
  test(`tap-response: ${tap.name} shows within ${String(LIMIT_MS)} ms while the write is pending`, async ({ browser }) => {
    test.setTimeout(300_000);
    const runs: number[] = [];
    const pendingRuns: boolean[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const result = await open(browser, tap);
      runs.push(result.ms);
      pendingRuns.push(result.pending);
    }
    const summary = `tap-response: ${tap.name} ${String(median(runs))} ms (limit ${String(LIMIT_MS)})`;
    const detail = `${summary}; runs ${runs.join(", ")} ms; pending while shown: ${pendingRuns.map(String).join(", ")}`;
    test.info().annotations.push({ type: "tap-response", description: detail });
    console.log(detail);
    expect(pendingRuns.every(Boolean), detail).toBe(true);
    expect(median(runs), detail).toBeLessThanOrEqual(LIMIT_MS);
  });
}

test("tap-response: a failed write rolls back within 2 s and toasts ניסיון חוזר, and the retry shows", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext(MOTION);
  const page = await context.newPage();
  const held = gate();
  await stubBackend(page);
  await slowWrite(page, "set_transaction_cash", held);
  await page.goto(`/transactions/${TXN_ID}`);
  await page.waitForLoadState("networkidle");
  const switchBox = cashSwitch(page);
  await expect(switchBox).toBeVisible({ timeout: 30_000 });
  const before = await switchBox.isChecked();
  held.failing = true;
  await switchBox.tap();
  // The 500 comes back after the hold; the switch is back to the server's state and a toast offers a retry.
  const retry = page.getByRole("button", { name: LABELS.retry, exact: true });
  await expect(retry).toBeVisible({ timeout: WRITE_MS + 3_000 });
  const failedAt = held.failedAt ?? Date.now();
  const toastMs = Date.now() - failedAt;
  expect(toastMs, `toast ${String(toastMs)} ms after the 500`).toBeLessThanOrEqual(2_000);
  expect(await switchBox.isChecked()).toBe(before);
  held.failing = false;
  await retry.tap();
  // The retry shows the tapped state again at once (decision 0180), then the server answers it.
  await expect.poll(() => switchBox.isChecked(), { intervals: [10], timeout: 10_000 }).toBe(!before);
  await expect.poll(() => held.answered, { message: "retry answered", timeout: WRITE_MS + 3_000 }).toBe(2);
  const line = `tap-response: failed write ${String(toastMs)} ms after the 500 (limit 2000); rolled back and retried`;
  test.info().annotations.push({ type: "tap-response", description: line });
  console.log(line);
  await context.close();
});
