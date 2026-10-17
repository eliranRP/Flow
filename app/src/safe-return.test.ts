import { afterEach, describe, expect, it } from "vitest";
import {
  afterSignInMessage,
  afterSignInPath,
  peekSignInReturn,
  rememberSignInReturn,
  safeSignInReturn,
  signInPathFor,
} from "./safe-return";

describe("safeSignInReturn", () => {
  it("accepts only listed screens, exactly", () => {
    for (const path of ["/review", "/review/filed", "/unpaid", "/projects", "/settings", "/settings/categories", "/settings?sheet=sumit", "/settings/connections", "/settings/connections?sheet=sumit", "/loans"]) {
      expect(safeSignInReturn(path)).toBe(path);
    }
    expect(afterSignInMessage(true, "/loans")).toBe("נכנסתם. עוברים להלוואות.");
    expect(afterSignInMessage(true, "/settings/connections")).toBe("נכנסתם. עוברים לחיבורים.");
  });

  it("drops home, off-list routes, and open redirects", () => {
    const rejected = [
      "/",
      "/install",
      "/onboarding",
      "/setup/welcome",
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

  it("stores a safe path, and clears it when the next sign-in has none", () => {
    rememberSignInReturn("/review");
    expect(peekSignInReturn()).toBe("/review");
    rememberSignInReturn(null);
    expect(peekSignInReturn()).toBeNull();
  });

  it("refuses a tampered stored value", () => {
    window.sessionStorage.setItem("flow.sign-in-return", "//evil.example");
    expect(peekSignInReturn()).toBeNull();
  });

  it("sends a new account to setup and a returning one to the stored screen or Home", () => {
    expect(afterSignInPath(false, "/review")).toBe("/setup/welcome");
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
