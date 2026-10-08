import { afterEach, describe, expect, it } from "vitest";
import {
  afterSignInMessage,
  afterSignInPath,
  rememberSignInReturn,
  safeAppPath,
  safeSignInReturn,
  signInPathFor,
  takeSignInReturn,
} from "./safe-return";

describe("safeAppPath", () => {
  it("accepts only the settings and connections paths", () => {
    expect(safeAppPath("/settings")).toBe("/settings");
    expect(safeAppPath("/settings?sheet=sumit")).toBe("/settings?sheet=sumit");
    expect(safeAppPath("/settings/connections")).toBe("/settings/connections");
    expect(safeAppPath("/settings/connections?sheet=sumit")).toBe("/settings/connections?sheet=sumit");
    expect(safeAppPath("/settings/connections?sheet=mercury")).toBeNull();
    expect(safeAppPath("/settings/connections/")).toBeNull();
    expect(safeAppPath("/settings/loans")).toBeNull();
  });

  it("drops dot-segment, scheme, and encoded open redirects", () => {
    const rejected = [
      "/..//evil.com",
      "/.//evil.com",
      "/%2e%2e//evil.com",
      "/%252e%252e//evil.com",
      "/%2e%2e/%2e%2e//evil.com",
      "/a/..//evil.com",
      "/\\evil",
      "\\\\evil",
      "javascript:alert(1)",
      "data:text/html,hi",
      "/%2F%2Fevil.com",
      "/%5Cevil",
      "/settings\t",
      "/settings\n",
      "/settings@evil.com",
      " /settings",
      "https://flow.invalid/settings?sheet=sumit",
      "https://evil.example/settings",
      "//evil.example",
      "/settings?preview=empty&sheet=sumit",
      "/Settings",
      "/SETTINGS",
      "/settings?Sheet=sumit",
      "/settings?sheet=SUMIT",
      "/settings/",
      "/settings/?sheet=sumit",
      "/settings?sheet=sumit&x=1",
      "/settings?foo=1",
      "/settings#x",
      "/settings?sheet=sumit#x",
      "/settings%3Fsheet=sumit",
      "/settings?sheet=sumit%26evil=1",
      "/onboarding",
      "settings",
      "",
      null,
    ];
    for (const value of rejected) expect(safeAppPath(value)).toBeNull();
  });
});

describe("safeSignInReturn", () => {
  it("accepts only listed screens, exactly", () => {
    for (const path of ["/review", "/review/filed", "/unpaid", "/projects", "/settings", "/settings/categories", "/settings?sheet=sumit", "/settings/connections", "/settings/connections?sheet=sumit", "/settings/loans"]) {
      expect(safeSignInReturn(path)).toBe(path);
    }
    expect(afterSignInMessage(true, "/settings/loans")).toBe("נכנסתם. עוברים להלוואות.");
    expect(afterSignInMessage(true, "/settings/connections")).toBe("נכנסתם. עוברים לחיבורים.");
  });

  it("drops home, off-list routes, and open redirects", () => {
    const rejected = [
      "/",
      "/install",
      "/onboarding",
      "/setup/0",
      "/transactions/abc",
      "/review/",
      "/review?x=1",
      "/review#x",
      "/Review",
      "/./review",
      "/a/../review",
      "/%72eview",
      "//evil.example/review",
      "https://evil.example/review",
      "/review@evil.example",
      "/\\evil",
      " /review",
      "/review\n",
      "review",
      "",
      null,
    ];
    for (const value of rejected) expect(safeSignInReturn(value)).toBeNull();
  });
});

describe("sign-in return across the redirect", () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("stores a safe path once and clears it on read", () => {
    rememberSignInReturn("/review");
    expect(takeSignInReturn()).toBe("/review");
    expect(takeSignInReturn()).toBeNull();
  });

  it("clears an earlier path when the next sign-in has none", () => {
    rememberSignInReturn("/review");
    rememberSignInReturn(null);
    expect(takeSignInReturn()).toBeNull();
  });

  it("refuses a tampered stored value", () => {
    window.sessionStorage.setItem("flow.sign-in-return", "//evil.example");
    expect(takeSignInReturn()).toBeNull();
  });

  it("sends a new account to setup and a returning one to the stored screen or Home", () => {
    expect(afterSignInPath(false, "/review")).toBe("/setup/0");
    expect(afterSignInPath(true, "/review")).toBe("/review");
    expect(afterSignInPath(true, "/install")).toBe("/");
    expect(afterSignInPath(true, null)).toBe("/");
  });

  it("names the destination from the list, never from the URL", () => {
    expect(afterSignInMessage(true, "/review")).toBe("נכנסתם. עוברים לאישור.");
    expect(afterSignInMessage(true, "/settings/categories")).toBe("נכנסתם. עוברים לקטגוריות.");
    expect(afterSignInMessage(true, "/install")).toBe("נכנסתם. עוברים לבית.");
    expect(afterSignInMessage(false, "/review")).toBe("נכנסתם. ממשיכים לפרטי העסק.");
  });

  it("builds the sign-in URL only for listed screens", () => {
    expect(signInPathFor("/review")).toBe("/sign-in?return=%2Freview");
    expect(signInPathFor("/")).toBe("/sign-in");
    expect(signInPathFor("/install")).toBe("/sign-in");
  });
});
