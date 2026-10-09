/** The Jev connector flag and the user and company it is scoped to. Re-exported by jev-review.ts. */
import type { QueryClient } from "@tanstack/react-query";

/** Separate from the suggestion read, and scoped so the next user does not reuse this one's on. */
export function jevConnectorQueryKey(scope: JevConnectorScope | null = boundJevConnectorScope()) {
  return scope == null
    ? (["jev-connector"] as const)
    : (["jev-connector", scope.userId, scope.companyId] as const);
}

/** FLOW-704: a minute, so a change made elsewhere (MCP, another device) reaches the card soon. */
export const JEV_CONNECTOR_STALE_MS = 60 * 1000;

/** Survives a reload, so the next launch still knows whether to wait on the card. */
const JEV_CONNECTOR_FLAG = "flow.jev-connector";

export type JevConnectorScope = { userId: string; companyId: string };

/** One flag per signed-in user and company. The old device-wide key is not read. */
export function jevConnectorStorageKey(scope: JevConnectorScope): string {
  return `${JEV_CONNECTOR_FLAG}:${scope.userId}:${scope.companyId}`;
}

let activeScope: JevConnectorScope | null = null;

/** The old key is deleted once per launch, not on every read (FLOW-704). */
let legacyKeyDropped = false;

/** `undefined` until auth has reported. Null is a reported sign-out. */
let notedAuthUser: string | null | undefined;

export type JevScopePhase = "off" | "pending" | "ready" | "miss";

let scopePhase: JevScopePhase = "off";
/** A miss reads the connector without the remembered flag. A later company row may still bind. */
let followsLive = false;
let scopeGeneration = 0;
const scopeListeners = new Set<() => void>();

function emitScope(): void {
  for (const listener of scopeListeners) listener();
}

export function jevScopePhase(): JevScopePhase {
  return scopePhase;
}

export function jevScopeFollowsLive(): boolean {
  return followsLive;
}

export function notedJevAuthUser(): string | null | undefined {
  return notedAuthUser;
}

export function subscribeJevScope(listener: () => void): () => void {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}

export function noteJevAuthUser(userId: string | null): void {
  notedAuthUser = userId;
}

export type JevScopeLookup = {
  generation: number;
  userAtStart: string | null | undefined;
};

/** The card subscribes. The list does not wait on this. A ready scope survives a same-user refetch. */
export function beginJevScopeLookup(): JevScopeLookup {
  scopeGeneration += 1;
  const sameUser = activeScope != null && (notedAuthUser === undefined || notedAuthUser === activeScope.userId);
  if (scopePhase === "ready" && sameUser) {
    return { generation: scopeGeneration, userAtStart: notedAuthUser };
  }
  followsLive = false;
  scopePhase = "pending";
  emitScope();
  return { generation: scopeGeneration, userAtStart: notedAuthUser };
}

/**
 * Applies a finished lookup only when it is still the current one.
 * A miss stores no scope. A stale finish does not clear a newer one.
 */
export function completeJevScopeLookup(lookup: JevScopeLookup, scope: JevConnectorScope | null): boolean {
  if (lookup.generation !== scopeGeneration) return false;
  if (lookup.userAtStart !== undefined && notedAuthUser !== lookup.userAtStart) return false;
  const signedOut = notedAuthUser === null;
  const otherUser = scope != null && typeof notedAuthUser === "string" && scope.userId !== notedAuthUser;
  if (signedOut || otherUser) {
    activeScope = null;
    followsLive = false;
    scopePhase = "off";
    emitScope();
    return false;
  }
  if (scope == null && scopePhase === "ready" && activeScope != null && (notedAuthUser === undefined || notedAuthUser === activeScope.userId)) {
    return true;
  }
  if (scope == null) {
    if (followsLive && activeScope != null) return true;
    activeScope = null;
    followsLive = true;
    scopePhase = "miss";
    emitScope();
    return true;
  }
  activeScope = scope;
  if (!followsLive) scopePhase = "ready";
  emitScope();
  return true;
}

/** Sign-out and a user switch invalidate a lookup that is still in flight. */
export function dropJevConnectorForAuthChange(): void {
  activeScope = null;
  followsLive = false;
  scopeGeneration += 1;
  scopePhase = "off";
  emitScope();
}

/** Test isolation. A later finish from the previous case does not land. */
export function resetJevScopeMemory(): void {
  activeScope = null;
  notedAuthUser = undefined;
  followsLive = false;
  scopeGeneration += 1;
  scopePhase = "off";
  legacyKeyDropped = false;
  emitScope();
}

export function bindJevConnectorScope(scope: JevConnectorScope | null): void {
  activeScope = scope;
}

export function boundJevConnectorScope(): JevConnectorScope | null {
  return activeScope;
}

/** The pre-scope device-wide key. It is deleted and never read as the flag. */
export function dropLegacyJevConnectorKey(): void {
  if (legacyKeyDropped || typeof localStorage === "undefined") return;
  legacyKeyDropped = true;
  try {
    localStorage.removeItem(JEV_CONNECTOR_FLAG);
  } catch {
    // A private window can refuse the delete. The scoped key is the only flag.
  }
}

function companyIdFrom(data: unknown): string | null {
  if (data == null || typeof data !== "object" || !("company_id" in data)) return null;
  const id = data.company_id;
  return typeof id === "string" && id !== "" ? id : null;
}

/** `list_review` omits this today. A payload that includes it is the company. */
export function companyIdFromReviewPayload(data: unknown): string | null {
  if (!Array.isArray(data)) return companyIdFrom(data);
  for (const row of data) {
    const id = companyIdFrom(row);
    if (id) return id;
  }
  return null;
}

/** True when any company flag for this user is on. The check is synchronous. */
export function userRememberedJevOn(userId: string): boolean {
  if (userId === "" || typeof localStorage === "undefined") return false;
  const prefix = `${JEV_CONNECTOR_FLAG}:${userId}:`;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key != null && key.startsWith(prefix) && localStorage.getItem(key) === "1") return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** The live read when the company is not known yet. Not the unscoped connector key. */
export function jevConnectorLiveKey(userId: string | null): readonly ["jev-connector", string, "session"] {
  return ["jev-connector", userId != null && userId !== "" ? userId : "session", "session"];
}

/**
 * FLOW-704: when the scope binds after this session's live read said on, the scoped key takes that
 * answer (and its time), so the connector is not read a second time. Only an answered on is
 * carried over; a read past its deadline is an error, never a known off.
 */
export function jevLiveOn(client: QueryClient, userId: string | null): number | null {
  const live = client.getQueryState<boolean>(jevConnectorLiveKey(userId));
  return live?.status === "success" && live.data === true ? live.dataUpdatedAt : null;
}

export function seedJevConnectorFromLive(client: QueryClient, scope: JevConnectorScope): void {
  const key = jevConnectorQueryKey(scope);
  if (client.getQueryData(key) !== undefined) return;
  const at = jevLiveOn(client, scope.userId);
  if (at == null) return;
  client.setQueryData(key, true, { updatedAt: at });
  writeJevConnectorFlag(true, scope);
}

export function readJevConnectorFlag(scope: JevConnectorScope): boolean | undefined {
  dropLegacyJevConnectorKey();
  if (typeof localStorage === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(jevConnectorStorageKey(scope));
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    return undefined;
  }
  return undefined;
}

export function writeJevConnectorFlag(on: boolean, scope: JevConnectorScope | null = activeScope): void {
  if (scope == null || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(jevConnectorStorageKey(scope), on ? "1" : "0");
  } catch {
    // A private window can refuse the write. The in-memory query still updates.
  }
}

/** Sign-out drops this user's flags and the old device-wide key. */
export function clearJevConnectorFlag(userId: string | null): void {
  dropJevConnectorForAuthChange();
  if (typeof localStorage === "undefined") return;
  try {
    const prefix = userId == null ? null : `${JEV_CONNECTOR_FLAG}:${userId}:`;
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === JEV_CONNECTOR_FLAG || (prefix != null && key != null && key.startsWith(prefix))) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // A private window can refuse the clear. The in-memory scope is already dropped.
  }
}
