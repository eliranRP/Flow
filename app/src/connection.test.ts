import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { followConnection } from "./connection";

function fakeWindow(onLine: boolean) {
  const target = new EventTarget() as EventTarget & { navigator: { onLine: boolean } };
  target.navigator = { onLine };
  return target;
}

const unreachable = () => Promise.resolve(false);
const reachable = () => Promise.resolve(true);

afterEach(() => {
  followConnection(fakeWindow(true), reachable);
});

describe("followConnection (FLOW-1140)", () => {
  it("starts offline when the browser has no connection and a request can't get through", async () => {
    const reach = vi.fn(unreachable);
    followConnection(fakeWindow(false), reach);
    expect(onlineManager.isOnline()).toBe(false);
    await vi.waitFor(() => { expect(reach).toHaveBeenCalledTimes(1); });
    expect(onlineManager.isOnline()).toBe(false);
  });

  it("comes back online when the browser says offline but a request gets through (a false negative)", async () => {
    followConnection(fakeWindow(false), reachable);
    await vi.waitFor(() => { expect(onlineManager.isOnline()).toBe(true); });
  });

  it("follows the browser's online and offline events", () => {
    const target = fakeWindow(true);
    followConnection(target, unreachable);
    expect(onlineManager.isOnline()).toBe(true);
    target.dispatchEvent(new Event("offline"));
    expect(onlineManager.isOnline()).toBe(false);
    target.dispatchEvent(new Event("online"));
    expect(onlineManager.isOnline()).toBe(true);
  });

  it("checks again on focus while offline, and not while online", async () => {
    const target = fakeWindow(false);
    let up = false;
    const reach = vi.fn(() => Promise.resolve(up));
    followConnection(target, reach);
    await vi.waitFor(() => { expect(reach).toHaveBeenCalledTimes(1); });
    expect(onlineManager.isOnline()).toBe(false);
    up = true;
    target.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => { expect(onlineManager.isOnline()).toBe(true); });
    target.dispatchEvent(new Event("focus"));
    expect(reach).toHaveBeenCalledTimes(2);
  });
});
