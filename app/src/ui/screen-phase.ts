export type ScreenPhase = { kind: "loading" } | { kind: "error"; offline: boolean } | { kind: "empty" } | { kind: "ready" };
