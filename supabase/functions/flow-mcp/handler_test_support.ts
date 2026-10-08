// Shared env, pepper and fake deps for the Flow MCP handler tests (split out of handler_test.ts, FLOW-807).


export function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

export function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: ${left} !== ${right}`);
}

export const pepperSecret = "p".repeat(32);
export const previousSecret = "q".repeat(32);
const pepper = JSON.stringify({
  kid: "test",
  secret: pepperSecret,
  previous: [{ kid: "old", secret: previousSecret }],
});
export const env: Record<string, string> = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEYS: '{"default":"secret-key"}',
  SUPABASE_PUBLISHABLE_KEYS: '{"default":"publishable-key"}',
  FLOW_MCP_PEPPER: pepper,
  FLOW_MCP_SIGNING_KEY: JSON.stringify({ kty: "EC", crv: "P-256", alg: "ES256", kid: "list-kid", d: "aa", x: "bb", y: "cc" }),
  FLOW_MCP_APP_ORIGINS: "http://127.0.0.1:43123,http://localhost:43123,https://flow-app-dx5.pages.dev",
};

export type Call = { url: string; body: Record<string, unknown> | null; authorization: string };

export function deps(
  calls: Call[],
  routes: Record<string, unknown>,
  options?: {
    userStatus?: number;
    userBody?: string;
    statuses?: Record<string, number>;
    env?: Record<string, string>;
  },
) {
  const source = options?.env ?? env;
  return {
    env: (name: string) => source[name],
    fetch: (input: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      const headers = new Headers(init?.headers);
      calls.push({ url: input, body, authorization: headers.get("authorization") ?? "" });
      const name = input.split("/").pop() ?? "";
      if (name === "user") {
        const status = options?.userStatus ?? 200;
        const text = options?.userBody ?? JSON.stringify({ id: "user-from-getuser" });
        return Promise.resolve(new Response(text, { status }));
      }
      const status = options?.statuses?.[name] ?? 200;
      const payload = routes[name];
      const json = Array.isArray(payload) ? payload.shift() : payload;
      return Promise.resolve(new Response(JSON.stringify(json ?? {}), { status }));
    },
  };
}
