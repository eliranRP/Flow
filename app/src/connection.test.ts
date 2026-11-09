import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { followConnection } from "./connection";

function fakeWindow(onLine: boolean) {
  const target = new EventTarget() as EventTarget & { navigator: { onLine: boolean } };
  target.navigator = { onLine };
  return target;
}

afterEach(() => {
  followConnection(fakeWindow(true));
});

describe("followConnection (FLOW-1140)", () => {
  it("starts offline when the browser has no connection, before any offline event", () => {
    followConnection(fakeWindow(false));
    expect(onlineManager.isOnline()).toBe(false);
  });

  it("follows the browser's online and offline events", () => {
    const target = fakeWindow(true);
    followConnection(target);
    expect(onlineManager.isOnline()).toBe(true);
    target.dispatchEvent(new Event("offline"));
    expect(onlineManager.isOnline()).toBe(false);
    target.dispatchEvent(new Event("online"));
    expect(onlineManager.isOnline()).toBe(true);
  });
});
