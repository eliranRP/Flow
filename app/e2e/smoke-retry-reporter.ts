import { appendFileSync } from "node:fs";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

/** Job-summary warning when a live smoke passed only after a retry. No log tail. */
export function retryWarning(titles: readonly string[]): string {
  const lines = [
    "### Warning: read-only smoke passed on retry",
    "",
    "The first attempt failed and a retry passed. Production is already live. The Playwright output is in the step log, not in this summary.",
    "",
    ...titles.map((title) => `- ${title}`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

class SmokeRetryReporter implements Reporter {
  private readonly passedOnRetry: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.retry > 0 && result.status === "passed") {
      this.passedOnRetry.push(test.titlePath().join(" › "));
    }
  }

  onEnd(): void {
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary == null || summary.length === 0 || this.passedOnRetry.length === 0) return;
    appendFileSync(summary, retryWarning(this.passedOnRetry));
  }
}

export default SmokeRetryReporter;
