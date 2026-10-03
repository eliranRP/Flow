// Jev HTTP client. Decision 0083.
// POST https://api.typesafe.ai/v1/systemone with { model, state, questions }.
// A body that uses `question` is rejected by TypeSafe with 400 "Invalid request".
// The model is pinned. 429 and 529 retry with backoff. Anything else fails closed.
// This module does not read the API key from the environment or from Vault.

export const JEV_MODEL = "jev-1.13.0";
export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_TIMEOUT_MS = 8_000;
export const JEV_MAX_ATTEMPTS = 4;
export const JEV_BACKOFF_BASE_MS = 200;
export const JEV_BACKOFF_CAP_MS = 8_000;

export type JevErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "rate_limited"
  | "overloaded"
  | "timeout"
  | "missing_key"
  | "unavailable";

export class JevError extends Error {
  readonly code: JevErrorCode;
  readonly status: number | null;

  constructor(code: JevErrorCode, status: number | null = null) {
    super(code);
    this.name = "JevError";
    this.code = code;
    this.status = status;
  }
}

type JsonObject = { [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export type NoulQuestion = {
  type: "noul";
  instructions: string | JsonObject | JsonValue[];
  criteria?: { true?: string; false?: string } | null;
};

export type ChoiceQuestion = {
  type: "choice";
  instructions: string | JsonObject | JsonValue[];
  criteria: Record<string, string | null>;
};

export type ScoreQuestion = {
  type: "score";
  instructions: string | JsonObject | JsonValue[];
  criteria: string[];
};

export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type JevState = string | JsonObject | JsonValue[];

export type JevCall = {
  state: JevState;
  questions: Record<string, JevQuestion>;
};

export type JevResult = {
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number } | null;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type JevTimer = {
  sleep(ms: number): Promise<void>;
  arm(ms: number, fire: () => void): { cancel(): void };
};

export type JevDeps = {
  fetch: FetchLike;
  timer?: JevTimer;
  timeoutMs?: number;
};

const realTimer: JevTimer = {
  sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
  arm(ms: number, fire: () => void) {
    const id = setTimeout(fire, ms);
    return { cancel: () => clearTimeout(id) };
  },
};

function fail(code: JevErrorCode): never {
  throw new JevError(code);
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertInstructions(value: unknown): void {
  if (typeof value === "string") {
    if (value.trim() === "") fail("invalid_request");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) fail("invalid_request");
    return;
  }
  if (!isObject(value) || Object.keys(value).length === 0) fail("invalid_request");
}

function assertQuestions(questions: Record<string, JevQuestion>): void {
  if (!isObject(questions)) fail("invalid_request");
  const keys = Object.keys(questions);
  if (keys.length === 0) fail("invalid_request");
  for (const key of keys) {
    if (key.trim() === "") fail("invalid_request");
    const question = questions[key];
    if (!isObject(question)) fail("invalid_request");
    assertInstructions(question.instructions);
    if (question.type === "noul") {
      if (question.criteria != null && !isObject(question.criteria)) fail("invalid_request");
      continue;
    }
    if (question.type === "choice") {
      if (!isObject(question.criteria)) fail("invalid_request");
      const options = Object.keys(question.criteria);
      if (options.length < 1 || options.length > 255) fail("invalid_request");
      continue;
    }
    if (question.type === "score") {
      if (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10) {
        fail("invalid_request");
      }
      if (question.criteria.some((level) => typeof level !== "string" || level.trim() === "")) {
        fail("invalid_request");
      }
      continue;
    }
    fail("invalid_request");
  }
}

function assertState(state: JevState): void {
  if (typeof state === "string") {
    if (state.trim() === "") fail("invalid_request");
    return;
  }
  if (Array.isArray(state) || isObject(state)) return;
  fail("invalid_request");
}

/** The wire body. `model` is always the pin. There is no `question` field. */
export function buildJevBody(input: JevCall): string {
  assertState(input.state);
  assertQuestions(input.questions);
  return JSON.stringify({
    model: JEV_MODEL,
    state: input.state,
    questions: input.questions,
  });
}

export function backoffMs(attempt: number, response: Response): number {
  const header = response.headers.get("retry-after");
  if (header !== null && /^\d+$/.test(header.trim())) {
    return Math.min(Number(header.trim()) * 1000, JEV_BACKOFF_CAP_MS);
  }
  const delay = JEV_BACKOFF_BASE_MS * 2 ** attempt;
  return Math.min(delay, JEV_BACKOFF_CAP_MS);
}

function statusError(status: number): JevError {
  if (status === 400 || status === 422) return new JevError("invalid_request", status);
  if (status === 401) return new JevError("unauthorized", status);
  if (status === 429) return new JevError("rate_limited", status);
  if (status === 529) return new JevError("overloaded", status);
  return new JevError("unavailable", status);
}

function isTimeout(error: unknown, timedOut: boolean): boolean {
  if (timedOut) return true;
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  return name === "TimeoutError";
}

async function parseResult(response: Response): Promise<JevResult> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new JevError("unavailable", response.status);
  }
  if (!isObject(body) || typeof body.model !== "string" || body.model.trim() === "" || !isObject(body.answers)) {
    throw new JevError("unavailable", response.status);
  }
  const usage = body.usage;
  const parsedUsage = isObject(usage)
      && typeof usage.input_tokens === "number"
      && typeof usage.output_tokens === "number"
    ? { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens }
    : null;
  return {
    model: body.model,
    answers: body.answers,
    usage: parsedUsage,
  };
}

export async function callJev(apiKey: string, input: JevCall, deps: JevDeps): Promise<JevResult> {
  const key = apiKey.trim();
  if (key === "") throw new JevError("missing_key");
  const body = buildJevBody(input);
  const timer = deps.timer ?? realTimer;
  const timeoutMs = deps.timeoutMs ?? JEV_TIMEOUT_MS;

  for (let attempt = 0; attempt < JEV_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    const armed = timer.arm(timeoutMs, () => {
      timedOut = true;
      controller.abort();
    });
    let response: Response;
    try {
      response = await deps.fetch(JEV_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (isTimeout(error, timedOut)) throw new JevError("timeout");
      throw new JevError("unavailable");
    } finally {
      armed.cancel();
    }

    if (response.ok) return await parseResult(response);
    if ((response.status === 429 || response.status === 529) && attempt < JEV_MAX_ATTEMPTS - 1) {
      await response.body?.cancel();
      await timer.sleep(backoffMs(attempt, response));
      continue;
    }
    await response.body?.cancel();
    throw statusError(response.status);
  }
  throw new JevError("unavailable");
}
