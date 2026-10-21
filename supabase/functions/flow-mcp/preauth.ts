// In-memory, isolate-local pre-auth flood gate (FLOW-945). A cheap first cap in
// front of the DB-backed note_auth_failure: it bounds unauthenticated /mcp
// attempts before any lookup_mcp_credential or note_auth_failure RPC runs, so a
// single flooding client (or a flood with no cf-connecting-ip) can only amplify
// DB load so far. note_auth_failure stays the durable, cross-isolate layer.
//
// The limits are generous enough that a real client never reaches them: one
// trusted IP gets PRE_AUTH_PER_IP_MAX failed attempts per window, and all
// requests with no trusted IP share one global bucket of PRE_AUTH_GLOBAL_MAX so
// a headerless flood is bounded instead of skipping the throttle. Only failed
// pre-auth attempts are charged, so an authenticated caller is never counted.
//
// Tradeoff: a valid authenticated request from an IP whose per-IP bucket is
// already full (60 failed attempts in 10s, e.g. several bad clients behind one
// shared NAT egress IP) gets the retryable 429. It self-heals within one window
// (<=10s) once the failures stop, and the alternative (skipping the IP bucket on
// a hit) would hand an attacker a free DB-amplification channel.

const PRE_AUTH_WINDOW_MS = 10_000;
const PRE_AUTH_PER_IP_MAX = 60;
const PRE_AUTH_GLOBAL_MAX = 240;
const PRE_AUTH_GLOBAL_KEY = "::no-ip::";
// Once this many live buckets exist, old windows are evicted on every fresh
// insert so the map that keys on the client-settable IP can never grow without
// bound, even under traffic that only ever peeks (zero failures, so no charge).
const PRE_AUTH_MAX_BUCKETS = 10_000;

type PreAuthWindow = { start: number; count: number };
const preAuthBuckets = new Map<string, PreAuthWindow>();
let maxBuckets = PRE_AUTH_MAX_BUCKETS;

function preAuthKey(ip: string | null): { key: string; max: number } {
  if (ip) return { key: `ip:${ip}`, max: PRE_AUTH_PER_IP_MAX };
  return { key: PRE_AUTH_GLOBAL_KEY, max: PRE_AUTH_GLOBAL_MAX };
}

function preAuthWindow(key: string, now: number): PreAuthWindow {
  const existing = preAuthBuckets.get(key);
  if (existing && now - existing.start < PRE_AUTH_WINDOW_MS) return existing;
  // A fresh insert (new IP, or an expired window reused) is the only place the
  // map grows, so sweep here: this keeps both the peek (preAuthOverLimit) and
  // the charge paths bounded, including peek-only authenticated traffic.
  const fresh = { start: now, count: 0 };
  preAuthBuckets.set(key, fresh);
  sweepPreAuth(now);
  return fresh;
}

function sweepPreAuth(now: number): void {
  if (preAuthBuckets.size <= maxBuckets) return;
  for (const [key, window] of preAuthBuckets) {
    if (now - window.start >= PRE_AUTH_WINDOW_MS) preAuthBuckets.delete(key);
  }
  if (preAuthBuckets.size <= maxBuckets) return;
  // Still over cap with only live windows (a rotating-IP flood): drop the
  // oldest per-IP buckets. The shared no-IP bucket is never dropped.
  const live = [...preAuthBuckets.entries()]
    .filter(([key]) => key !== PRE_AUTH_GLOBAL_KEY)
    .sort((a, b) => a[1].start - b[1].start);
  for (const [key] of live) {
    if (preAuthBuckets.size <= maxBuckets) break;
    preAuthBuckets.delete(key);
  }
}

/** True when this IP's bucket (or the no-IP bucket) is already at its limit for the window. */
export function preAuthOverLimit(ip: string | null, now: number): { over: boolean; retry: number } {
  const { key, max } = preAuthKey(ip);
  const window = preAuthWindow(key, now);
  if (window.count < max) return { over: false, retry: 0 };
  const retry = Math.max(1, Math.ceil((window.start + PRE_AUTH_WINDOW_MS - now) / 1000));
  return { over: true, retry };
}

/** Count one failed pre-auth attempt against this IP's bucket (or the no-IP bucket). */
export function chargePreAuth(ip: string | null, now: number): void {
  const { key } = preAuthKey(ip);
  preAuthWindow(key, now).count += 1;
}

/** @forTests clear the gate and restore the production bucket cap. */
export function resetPreAuthGate(): void {
  preAuthBuckets.clear();
  maxBuckets = PRE_AUTH_MAX_BUCKETS;
}

/** @forTests shrink the bucket cap so eviction runs without inserting 10k entries. */
export function setPreAuthMaxBucketsForTests(limit: number): void {
  maxBuckets = limit;
}

/** @forTests the live bucket count and whether the shared no-IP bucket is present. */
export function preAuthStatsForTests(): { size: number; hasGlobal: boolean } {
  return { size: preAuthBuckets.size, hasGlobal: preAuthBuckets.has(PRE_AUTH_GLOBAL_KEY) };
}
