/**
 * Connector port. L0 contract only: no engine, no HTTP, no provider branch.
 * Provider unions live in this module. A later provider is a new union member
 * and a registry entry, not an `if` in the core.
 * See docs/tech/connector-contract.md.
 */
import { z } from "npm:zod@4.1.8";

export const PROVIDERS = ["sumit", "mercury"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const LISTING_CAPABILITIES = ["full", "window"] as const;
export type ListingCapability = (typeof LISTING_CAPABILITIES)[number];

export const REMOVAL_CAPABILITIES = ["sweep", "status"] as const;
export type RemovalCapability = (typeof REMOVAL_CAPABILITIES)[number];

export const CONNECTOR_ERROR_CLASSES = ["auth", "rejected", "rate_limited", "transient"] as const;
export type ConnectorErrorClass = (typeof CONNECTOR_ERROR_CLASSES)[number];

export const SKIP_REASONS = [
  "own_account_transfer",
  "internal_transfer",
  "treasury_transfer",
  "not_a_line",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export const LINE_STATUSES = ["pending", "posted", "void"] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

export const DIRECTIONS = ["income", "expense"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Matches public.vat_status. Mercury uses amount 0 and status `source`. */
export const VAT_STATUSES = ["source", "derived", "assumed", "unknown"] as const;
export type VatStatus = (typeof VAT_STATUSES)[number];

export const KEK_ENVS = ["SUMIT_KEK", "MERCURY_KEK"] as const;
export type KekEnv = (typeof KEK_ENVS)[number];

export const CONNECTOR_COPY_KEYS = [
  "status.connected",
  "status.disconnected",
  "status.reconnect",
  "sync.today",
  "sync.yesterday",
  "sync.older",
  "refresh.failed",
  "pending.tag",
  "range.from_start",
  "currency.ils",
  "currency.usd",
] as const;
export type ConnectorCopyKey = (typeof CONNECTOR_COPY_KEYS)[number];

export interface ConnectorCapabilities {
  listing: ListingCapability;
  removal: RemovalCapability;
  currencies: readonly string[];
  hasPending: boolean;
}

export const SUMIT_CAPABILITIES: ConnectorCapabilities = {
  listing: "full",
  removal: "sweep",
  currencies: ["ILS"],
  hasPending: false,
};

export const MERCURY_CAPABILITIES: ConnectorCapabilities = {
  listing: "window",
  removal: "status",
  currencies: ["USD"],
  hasPending: true,
};

/** id and label only. Never an account number or a routing number. */
export interface AccountLabel {
  id: string;
  label: string;
}

export type ValidateResult =
  | { ok: true; accounts: AccountLabel[] }
  | { ok: false; error: "auth_error" };

export interface FetchSinceInput {
  cursor: string | null;
  /** Null is מההתחלה. */
  importFrom: string | null;
  lookbackDays: number;
}

export interface FetchSinceResult {
  lines: unknown[];
  removedIds: string[];
  nextCursor: string | null;
  /** True only for a complete listing. A windowed page is false. */
  complete: boolean;
}

export interface Counterparty {
  name: string | null;
  external_id: string | null;
}

export interface Vat {
  /** Minor units. Nonnegative. Direction carries the sign. */
  amount: number;
  status: VatStatus;
}

/**
 * One provider line, before the engine writes ILS amount_gross and amount_net.
 * amount_original is minor units of `currency` (agorot or cents).
 */
export interface CanonicalLine {
  source: ProviderId;
  external_id: string;
  direction: Direction;
  status: LineStatus;
  currency: string;
  amount_original: number;
  doc_date: string;
  cash_date: string | null;
  counterparty: Counterparty;
  description: string;
  vat: Vat;
  project_hint: string | null;
  category_hint: string | null;
  linked_external_id: string | null;
  /** Opaque to the core. The adapter must not put secrets or routing data here. */
  provider_meta: Record<string, unknown>;
}

const dateShape = /^\d{4}-\d{2}-\d{2}$/;
const currencyShape = /^[A-Z]{3}$/;

export const canonicalLineSchema: z.ZodType<CanonicalLine> = z.strictObject({
  source: z.enum(PROVIDERS),
  external_id: z.string().min(1),
  direction: z.enum(DIRECTIONS),
  status: z.enum(LINE_STATUSES),
  currency: z.string().regex(currencyShape),
  amount_original: z.number().int().nonnegative(),
  doc_date: z.string().regex(dateShape),
  cash_date: z.string().regex(dateShape).nullable(),
  counterparty: z.strictObject({
    name: z.string().nullable(),
    external_id: z.string().nullable(),
  }),
  description: z.string(),
  vat: z.strictObject({
    amount: z.number().int().nonnegative(),
    status: z.enum(VAT_STATUSES),
  }),
  project_hint: z.string().nullable(),
  category_hint: z.string().nullable(),
  linked_external_id: z.string().nullable(),
  provider_meta: z.record(z.string(), z.unknown()),
});

export function parseCanonicalLine(value: unknown): CanonicalLine {
  return canonicalLineSchema.parse(value);
}

export type NormalizeResult =
  | { ok: true; line: CanonicalLine }
  | { ok: false; skip: SkipReason };

export interface ConnectorPort {
  capabilities: ConnectorCapabilities;
  /** Path prefixes only. The Mercury list is GET-only. */
  allowlist: readonly string[];
  validate(secret: string): Promise<ValidateResult>;
  fetchSince(input: FetchSinceInput): Promise<FetchSinceResult>;
  normalize(raw: unknown): NormalizeResult;
  classifyError(error: unknown): ConnectorErrorClass;
  redact(value: unknown): unknown;
}

export interface ConnectorSchedule {
  daily: "0 3 * * *";
  drain: "*/5 * * * *";
}

export interface ConnectorRegistration {
  adapter: ConnectorPort;
  kekEnv: KekEnv;
  schedule: ConnectorSchedule;
}

/** The server registry. L2 fills the map. This layer does not branch on provider. */
export type ConnectorRegistry = Readonly<Record<ProviderId, ConnectorRegistration>>;

export interface ConnectorClientDescriptor {
  provider: ProviderId;
  nameHe: string;
  icon: ProviderId;
  copy: Record<ConnectorCopyKey, string>;
}
