import { expect, test } from "@playwright/test";

/**
 * FLOW-804, decision 0034: Home is usable within 2 seconds on a mid-range phone on 4G. The page is
 * /?preview=1, Home without sign-in or a data read. Ready is the tab bar on screen. The median of
 * 3 loads must be under 2 s plus 10% for noisy runners.
 */
const MID_RANGE_4G = { cpu: 4, latency: 85, downloadThroughput: 9_000_000 / 8, uploadThroughput: 1_500_000 / 8 };
const LIMIT_MS = 2000 * 1.1;

test("Home is ready within 2 seconds on a mid-range phone on 4G", async ({ browser }) => {
  test.setTimeout(120_000);
  const runs: number[] = [];
  for (let run = 0; run < 3; run += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: MID_RANGE_4G.cpu });
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: MID_RANGE_4G.latency,
      downloadThroughput: MID_RANGE_4G.downloadThroughput,
      uploadThroughput: MID_RANGE_4G.uploadThroughput,
    });
    const start = Date.now();
    await page.goto("/?preview=1", { waitUntil: "commit" });
    await expect(page.getByRole("navigation", { name: "ניווט ראשי" })).toBeVisible({ timeout: 30_000 });
    runs.push(Date.now() - start);
    await context.close();
  }
  const median = [...runs].sort((a, b) => a - b)[1] ?? Number.POSITIVE_INFINITY;
  const summary = `Home ready: median ${String(median)} ms (${runs.join(", ")} ms), limit ${String(LIMIT_MS)} ms`;
  test.info().annotations.push({ type: "home-ready", description: summary });
  console.log(summary);
  expect(median, summary).toBeLessThanOrEqual(LIMIT_MS);
});
