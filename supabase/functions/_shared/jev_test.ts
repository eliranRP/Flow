import { JevError, backoffMs, buildJevBody, callJev, JEV_MODEL, JEV_URL, type JevCall, type JevTimer } from "./jev.ts";
import { readJevApiKey } from "./jev_key.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: ${left} !== ${right}`);
}

const sample: JevCall = {
  state: "בלוקים 2200",
  questions: {
    overhead: { type: "noul", instructions: "Is this overhead?" },
    project: {
      type: "choice",
      instructions: "Which project?",
      criteria: { site: "A job site", other: null },
    },
    anomaly: {
      type: "score",
      instructions: "How unusual is the amount?",
      criteria: ["Ordinary", "Unusual"],
    },
  },
};

const answer = {
  model: "jev-1.13.0",
  answers: {
    overhead: { type: "noul", noul: 0.04 },
    project: {
      type: "choice",
      choice: "site",
      probabilities: { site: 0.91, other: 0.09 },
      confidence: 0.82,
    },
  },
  usage: { input_tokens: 20, output_tokens: 4 },
};

function quietTimer(sleeps: number[]): JevTimer {
  return {
    sleep(ms: number) {
      sleeps.push(ms);
      return Promise.resolve();
    },
    arm() {
      return { cancel() {} };
    },
  };
}

function jsonResponse(status: number, body: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.test("the request body is model, state, and questions, with the pinned model", () => {
  const parsed = JSON.parse(buildJevBody(sample)) as Record<string, unknown>;
  assertEquals(Object.keys(parsed), ["model", "state", "questions"], "key order");
  assertEquals(parsed.model, "jev-1.13.0", "pin");
  assertEquals(JEV_MODEL, "jev-1.13.0", "constant");
  assertEquals(parsed.question, undefined, "singular question is not sent");
  assertEquals(parsed.state, sample.state, "state");
  const questions = parsed.questions as Record<string, { type: string }>;
  assertEquals(questions.overhead.type, "noul", "noul");
  assertEquals(questions.project.type, "choice", "choice");
  assertEquals(questions.anomaly.type, "score", "score");
});

Deno.test("a structured state is sent unchanged", () => {
  const state = { description: "בלוקים", amount_net: -220000 };
  const parsed = JSON.parse(buildJevBody({ state, questions: sample.questions })) as { state: typeof state };
  assertEquals(parsed.state, state, "state object");
});

Deno.test("an empty question map, a blank state, and a short score fail before any request", async () => {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = (input) => {
    calls.push(String(input));
    return Promise.resolve(jsonResponse(200, answer));
  };
  const deps = { fetch, timer: quietTimer([]) };
  await assertRejects(() => callJev("test-key", { state: "x", questions: {} }, deps), "invalid_request");
  await assertRejects(() => callJev("test-key", { state: "  ", questions: sample.questions }, deps), "invalid_request");
  await assertRejects(() => callJev("test-key", {
    state: "x",
    questions: { anomaly: { type: "score", instructions: "rate", criteria: ["only one"] } },
  }, deps), "invalid_request");
  await assertRejects(() => callJev("   ", sample, deps), "missing_key");
  assertEquals(calls, [], "no request");
});

Deno.test("a successful call returns answers and sends the bearer token", async () => {
  const seen: { url: string; authorization: string; body: Record<string, unknown> }[] = [];
  const result = await callJev("test-key", sample, {
    timer: quietTimer([]),
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({
        url: String(input),
        authorization: headers.get("authorization") ?? "",
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return Promise.resolve(jsonResponse(200, answer));
    },
  });
  assertEquals(seen.length, 1, "one request");
  assertEquals(seen[0].url, JEV_URL, "url");
  assertEquals(seen[0].authorization, "Bearer test-key", "bearer");
  assertEquals(seen[0].body.model, JEV_MODEL, "pin");
  assertEquals(result.model, "jev-1.13.0", "response model");
  assertEquals(result.answers.project, answer.answers.project, "choice answer");
  assertEquals(result.usage, answer.usage, "usage");
});

Deno.test("400 and 422 are invalid_request and are not retried", async () => {
  for (const status of [400, 422]) {
    const sleeps: number[] = [];
    let calls = 0;
    const error = await assertRejects(() => callJev("super-secret-value", sample, {
      timer: quietTimer(sleeps),
      fetch: () => {
        calls += 1;
        return Promise.resolve(new Response("Invalid request", { status }));
      },
    }), "invalid_request");
    assertEquals(error.status, status, `status ${status}`);
    assertEquals(calls, 1, `attempts ${status}`);
    assertEquals(sleeps, [], `no sleep ${status}`);
    assert(!String(error).includes("super-secret-value"), "error hides the key");
    assert(!error.message.includes("Invalid request"), "error hides the body");
  }
});

Deno.test("401 is unauthorized and 500 is unavailable, each without a retry", async () => {
  const unauthorized = await countStatus(401);
  assertEquals(unauthorized.code, "unauthorized", "401");
  assertEquals(unauthorized.calls, 1, "401 once");
  const unavailable = await countStatus(500);
  assertEquals(unavailable.code, "unavailable", "500");
  assertEquals(unavailable.calls, 1, "500 once");
});

Deno.test("529 then 200 returns the answer after one backoff", async () => {
  const sleeps: number[] = [];
  let calls = 0;
  const result = await callJev("test-key", sample, {
    timer: quietTimer(sleeps),
    fetch: () => {
      calls += 1;
      if (calls === 1) return Promise.resolve(jsonResponse(529, { error: "overloaded" }));
      return Promise.resolve(jsonResponse(200, answer));
    },
  });
  assertEquals(calls, 2, "retried");
  assertEquals(sleeps, [200], "first backoff");
  assertEquals(result.answers.overhead, answer.answers.overhead, "positive answer");
});

Deno.test("429 uses Retry-After, caps it, and fails closed when retries run out", async () => {
  const capped = await retryDelays(429, "100");
  assertEquals(capped, [8000, 8000, 8000], "cap");

  const sleeps: number[] = [];
  let calls = 0;
  const error = await assertRejects(() => callJev("test-key", sample, {
    timer: quietTimer(sleeps),
    fetch: () => {
      calls += 1;
      return Promise.resolve(jsonResponse(429, { leaked: "super-secret-value" }, { "retry-after": "2" }));
    },
  }), "rate_limited");
  assertEquals(calls, 4, "four attempts");
  assertEquals(sleeps, [2000, 2000, 2000], "retry-after seconds");
  assertEquals(error.status, 429, "status");
  assert(!String(error).includes("super-secret-value"), "error hides the body");
});

Deno.test("a timeout is not retried", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const error = await assertRejects(() => callJev("test-key", sample, {
    timeoutMs: 25,
    timer: {
      sleep(ms: number) {
        sleeps.push(ms);
        return Promise.resolve();
      },
      arm(_ms, fire) {
        fire();
        return { cancel() {} };
      },
    },
    fetch: (_input, init) => {
      calls += 1;
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException("timed out", "TimeoutError"));
      }
      return Promise.reject(new Error("should have aborted"));
    },
  }), "timeout");
  assertEquals(error.status, null, "no status");
  assertEquals(calls, 1, "one attempt");
  assertEquals(sleeps, [], "no backoff");
});

Deno.test("a stalled body times out at the limit and is not retried", async () => {
  let calls = 0;
  const started = Date.now();
  const error = await assertRejects(() => callJev("test-key", sample, {
    timeoutMs: 50,
    timer: {
      sleep() {
        return Promise.resolve();
      },
      arm(ms, fire) {
        const id = setTimeout(fire, ms);
        return { cancel() { clearTimeout(id); } };
      },
    },
    fetch: (_input, init) => {
      calls += 1;
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const stream = new ReadableStream({
        start(controller) {
          streamController = controller;
        },
      });
      init?.signal?.addEventListener("abort", () => {
        try {
          streamController?.error(new DOMException("timed out", "TimeoutError"));
        } catch {
          // The body may already be closed.
        }
      });
      return Promise.resolve(new Response(stream, {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    },
  }), "timeout");
  const elapsed = Date.now() - started;
  assertEquals(error.status, null, "no status");
  assertEquals(calls, 1, "one attempt");
  assert(elapsed >= 40, "waited for the limit");
  assert(elapsed < 1000, "did not hang past the limit");
});

Deno.test("a returned model other than the pin is kept", async () => {
  const result = await callJev("test-key", sample, {
    timer: quietTimer([]),
    fetch: () => Promise.resolve(jsonResponse(200, { ...answer, model: "jev-1.99.0" })),
  });
  assertEquals(result.model, "jev-1.99.0", "returned model");
});

Deno.test("a non-OK body is cancelled before the retry", async () => {
  const events: string[] = [];
  let calls = 0;
  await callJev("test-key", sample, {
    timer: {
      sleep() {
        events.push("sleep");
        return Promise.resolve();
      },
      arm() {
        return { cancel() {} };
      },
    },
    fetch: () => {
      calls += 1;
      if (calls === 1) {
        const stream = new ReadableStream({
          cancel() {
            events.push("cancel");
          },
        });
        return Promise.resolve(new Response(stream, { status: 529, headers: { "retry-after": "1" } }));
      }
      events.push("second");
      return Promise.resolve(jsonResponse(200, answer));
    },
  });
  assertEquals(events, ["cancel", "sleep", "second"], "cancel before backoff");
});

Deno.test("a network failure is unavailable and is not retried", async () => {
  const sleeps: number[] = [];
  let calls = 0;
  await assertRejects(() => callJev("test-key", sample, {
    timer: quietTimer(sleeps),
    fetch: () => {
      calls += 1;
      return Promise.reject(new Error("connect refused"));
    },
  }), "unavailable");
  assertEquals(calls, 1, "once");
  assertEquals(sleeps, [], "no sleep");
});

Deno.test("a 200 without answers fails closed", async () => {
  let calls = 0;
  await assertRejects(() => callJev("test-key", sample, {
    timer: quietTimer([]),
    fetch: () => {
      calls += 1;
      return Promise.resolve(jsonResponse(200, { model: "jev-1.13.0" }));
    },
  }), "unavailable");
  assertEquals(calls, 1, "once");
});

Deno.test("backoff without Retry-After doubles from the base", () => {
  const response = new Response(null, { status: 529 });
  assertEquals(backoffMs(0, response), 200, "base");
  assertEquals(backoffMs(1, response), 400, "second");
  assertEquals(backoffMs(2, response), 800, "third");
});

Deno.test("readJevApiKey posts to the service-role RPC and returns the JSON string", async () => {
  const seen: { url: string; authorization: string; apikey: string; body: string }[] = [];
  const key = await readJevApiKey({
    supabaseUrl: "http://127.0.0.1:54321/",
    serviceKey: "service-role-test",
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({
        url: String(input),
        authorization: headers.get("authorization") ?? "",
        apikey: headers.get("apikey") ?? "",
        body: String(init?.body),
      });
      return Promise.resolve(jsonResponse(200, "jev-test-secret"));
    },
  });
  assertEquals(key, "jev-test-secret", "positive read");
  assertEquals(seen.length, 1, "one call");
  assertEquals(seen[0].url, "http://127.0.0.1:54321/rest/v1/rpc/read_jev_api_key", "rpc");
  assertEquals(seen[0].authorization, "Bearer service-role-test", "bearer");
  assertEquals(seen[0].apikey, "service-role-test", "apikey");
  assertEquals(seen[0].body, "{}", "empty body");
  assert(!seen[0].url.includes("vault"), "url does not name vault");
});

Deno.test("readJevApiKey fails closed and does not echo the response body", async () => {
  const error = await assertRejects(() => readJevApiKey({
    supabaseUrl: "http://127.0.0.1:54321",
    serviceKey: "service-role-test",
    fetch: () => Promise.resolve(jsonResponse(403, { message: "super-secret-value" })),
  }), "missing_key");
  assertEquals(error.status, 403, "status");
  assert(!String(error).includes("super-secret-value"), "body hidden");

  let calls = 0;
  await assertRejects(() => readJevApiKey({
    supabaseUrl: "  ",
    serviceKey: "service-role-test",
    fetch: () => {
      calls += 1;
      return Promise.resolve(jsonResponse(200, "jev-test-secret"));
    },
  }), "missing_key");
  assertEquals(calls, 0, "no request without a url");

  await assertRejects(() => readJevApiKey({
    supabaseUrl: "http://127.0.0.1:54321",
    serviceKey: "service-role-test",
    fetch: () => Promise.resolve(jsonResponse(200, "")),
  }), "missing_key");
});

async function countStatus(status: number): Promise<{ code: string; calls: number }> {
  let calls = 0;
  const error = await assertRejects(() => callJev("test-key", sample, {
    timer: quietTimer([]),
    fetch: () => {
      calls += 1;
      return Promise.resolve(jsonResponse(status, { leaked: "super-secret-value" }));
    },
  }), status === 401 ? "unauthorized" : "unavailable");
  return { code: error.code, calls };
}

async function retryDelays(status: number, retryAfter: string): Promise<number[]> {
  const sleeps: number[] = [];
  let calls = 0;
  await assertRejects(() => callJev("test-key", sample, {
    timer: quietTimer(sleeps),
    fetch: () => {
      calls += 1;
      return Promise.resolve(jsonResponse(status, {}, { "retry-after": retryAfter }));
    },
  }), status === 429 ? "rate_limited" : "overloaded");
  assertEquals(calls, 4, "exhausted");
  return sleeps;
}

async function assertRejects(run: () => Promise<unknown>, code: string): Promise<JevError> {
  try {
    await run();
  } catch (caught) {
    if (!(caught instanceof JevError)) throw new Error("expected JevError");
    assertEquals(caught.code, code, "code");
    assertEquals(caught.message, code, "message is the code");
    return caught;
  }
  throw new Error(`expected ${code}`);
}
