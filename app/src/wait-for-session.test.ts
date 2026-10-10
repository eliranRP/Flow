// @vitest-environment node
import { describe, expect, it } from "vitest";
import { waitForAccessToken } from "./wait-for-session";

function reader(tokens: Array<string | null>) {
  const calls: number[] = [];
  return {
    calls,
    client: {
      auth: {
        getSession: () => {
          calls.push(calls.length + 1);
          const token = tokens[Math.min(calls.length, tokens.length) - 1] ?? null;
          const session = token == null ? null : { access_token: token };
          return Promise.resolve({ data: { session } });
        },
      },
    },
  };
}

describe("waitForAccessToken", () => {
  it("returns immediately when the client cannot read a session", async () => {
    await waitForAccessToken({});
    await waitForAccessToken({ auth: {} });
  });

  it("returns when the access token is already attached", async () => {
    const { calls, client } = reader(["tok"]);
    await waitForAccessToken(client, { now: () => 0, sleep: () => Promise.resolve() });
    expect(calls).toEqual([1]);
  });

  it("waits until a later read attaches the token", async () => {
    const { calls, client } = reader([null, "", "tok"]);
    let now = 0;
    await waitForAccessToken(client, {
      timeoutMs: 1_000,
      intervalMs: 50,
      now: () => now,
      sleep: (ms) => {
        now += ms;
        return Promise.resolve();
      },
    });
    expect(calls).toEqual([1, 2, 3]);
    expect(now).toBe(100);
  });

  it("throws when the session never attaches, without leaving the caller signed in", async () => {
    const { calls, client } = reader([null]);
    let now = 0;
    await expect(waitForAccessToken(client, {
      timeoutMs: 100,
      intervalMs: 50,
      now: () => now,
      sleep: (ms) => {
        now += ms;
        return Promise.resolve();
      },
    })).rejects.toThrow("session");
    expect(calls.length).toBeGreaterThan(1);
    expect(now).toBeGreaterThanOrEqual(100);
  });
});
