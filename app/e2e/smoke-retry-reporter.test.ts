import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TestCase, TestResult } from "@playwright/test/reporter";
import SmokeRetryReporter, { retryWarning } from "./smoke-retry-reporter";

function testCase(title: string): TestCase {
  return { titlePath: () => ["", "smoke", title] } as unknown as TestCase;
}

function result(retry: number, status: TestResult["status"]): TestResult {
  return { retry, status } as unknown as TestResult;
}

describe("smoke retry reporter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("formats a warning with each title", () => {
    expect(retryWarning(["a › b"])).toBe(
      "### Warning: read-only smoke passed on retry\n\nThe first attempt failed and a retry passed. Production is already live. The Playwright output is in the step log, not in this summary.\n\n- a › b\n\n",
    );
  });

  it("writes the warning only for tests that passed on a retry", () => {
    const summary = path.join(mkdtempSync(path.join(tmpdir(), "smoke-")), "summary.md");
    writeFileSync(summary, "");
    vi.stubEnv("GITHUB_STEP_SUMMARY", summary);
    const reporter = new SmokeRetryReporter();
    reporter.onTestEnd(testCase("first try"), result(0, "passed"));
    reporter.onTestEnd(testCase("still failing"), result(1, "failed"));
    reporter.onTestEnd(testCase("flaky"), result(1, "passed"));
    reporter.onEnd();
    expect(readFileSync(summary, "utf8")).toBe(retryWarning([" › smoke › flaky"]));
  });

  it("writes nothing when every test passed first time or there is no summary file", () => {
    const summary = path.join(mkdtempSync(path.join(tmpdir(), "smoke-")), "summary.md");
    writeFileSync(summary, "");
    vi.stubEnv("GITHUB_STEP_SUMMARY", summary);
    const quiet = new SmokeRetryReporter();
    quiet.onTestEnd(testCase("first try"), result(0, "passed"));
    quiet.onEnd();
    expect(readFileSync(summary, "utf8")).toBe("");
    vi.stubEnv("GITHUB_STEP_SUMMARY", "");
    const unset = new SmokeRetryReporter();
    unset.onTestEnd(testCase("flaky"), result(1, "passed"));
    expect(() => {
      unset.onEnd();
    }).not.toThrow();
  });
});
