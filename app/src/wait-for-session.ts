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
 * A getSession that does not answer within one interval does not hold the read.
 * A session that answers without a token is polled until the deadline.
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
    const value = await sessionAnswer(auth.getSession, intervalMs);
    if (value == null) return;
    const token = value.data?.session?.access_token;
    if (typeof token === "string" && token.length > 0) return;
    if (now() >= deadline) waiting = false;
    else await sleep(intervalMs);
  }
  throw new Error("session");
}

type SessionAnswer = { data: { session: { access_token?: string } | null } | null };

/** `undefined` means getSession did not answer within `settleMs`. */
function sessionAnswer(read: () => Promise<SessionAnswer>, settleMs: number): Promise<SessionAnswer | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(undefined);
    }, settleMs);
    read().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("session"));
      },
    );
  });
}
