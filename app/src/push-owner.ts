/**
 * FLOW-516: which user this browser's push subscription was saved for. Auth reads it on every
 * sign-in (it is a few bytes, so it can sit in Home's load) and drops the subscription when
 * another user signs in. An expired session keeps it (decision 0201).
 */
const KEY = "flow-push-user";

export function pushOwner(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function notePushOwner(userId: string | null): void {
  try {
    if (userId == null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, userId);
  } catch {
    // Storage blocked: a later user keeps the subscription until the server drops it.
  }
}
