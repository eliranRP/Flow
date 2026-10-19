import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { whenReadsSettle } from "./reads-settled";

afterEach(() => {
  vi.useRealTimers();
});

describe("screen preload waits for the first reads", () => {
  it("runs at once when nothing is reading", () => {
    const run = vi.fn();
    whenReadsSettle(new QueryClient(), run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("waits while a read is out and runs once it settles", async () => {
    const client = new QueryClient();
    let answer: (value: number) => void = () => undefined;
    void client.query({ queryKey: ["dashboard"], queryFn: () => new Promise<number>((resolve) => { answer = resolve; }) });
    const run = vi.fn();
    whenReadsSettle(client, run);
    expect(run).not.toHaveBeenCalled();
    answer(1);
    await vi.waitFor(() => { expect(run).toHaveBeenCalledTimes(1); });
  });

  it("runs after the cap when a read hangs, and only once", () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    void client.query({ queryKey: ["dashboard"], queryFn: () => new Promise<number>(() => undefined) });
    const run = vi.fn();
    whenReadsSettle(client, run, 5_000);
    vi.advanceTimersByTime(4_999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never runs once cancelled", () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    void client.query({ queryKey: ["dashboard"], queryFn: () => new Promise<number>(() => undefined) });
    const run = vi.fn();
    const cancel = whenReadsSettle(client, run, 5_000);
    cancel();
    vi.advanceTimersByTime(10_000);
    expect(run).not.toHaveBeenCalled();
  });
});
