type SessionClient = {
  auth?: {
    getSession?: () => Promise<{ data: { session: { access_token?: string } | null } | null }>;
  };
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_INTERVAL_MS = 50;

/**
 * List reads wait until the client has an access token.
 * A test double with no getSession does not wait.
 * The clock is injectable so a missed session fails without a real delay.
 */
export async function waitForAccessToken(
  client: SessionClient,
  options?: {
    timeoutMs?: number;
    intervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<void> {
  const auth = client.auth;
  if (auth == null || typeof auth.getSession !== "function") return;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const sleep = options?.sleep ?? ((ms: number) => new Promise((resolve) => {
    setTimeout(resolve, ms);
  }));
  const now = options?.now ?? Date.now;
  const deadline = now() + timeoutMs;
  let waiting = true;
  while (waiting) {
    const { data } = await auth.getSession();
    const token = data?.session?.access_token;
    if (typeof token === "string" && token.length > 0) return;
    if (now() >= deadline) waiting = false;
    else await sleep(intervalMs);
  }
  throw new Error("session");
}
