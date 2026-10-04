/**
 * Connector port. L0 contract only: no engine, no HTTP, no provider branch.
 * Provider names, KEK env names, capability rows, and provider skip reasons
 * live under connectors/<provider>/ and in registry.ts. This file has neither.
 * See docs/tech/connector-contract.md.
 */
import { z } from "zod";

export const LISTING_CAPABILITIES = ["full", "window"] as const;
export type ListingCapability = (typeof LISTING_CAPABILITIES)[number];

export const REMOVAL_CAPABILITIES = ["sweep", "status"] as const;
export type RemovalCapability = (typeof REMOVAL_CAPABILITIES)[number];

export const CONNECTOR_ERROR_CLASSES = ["auth", "rejected", "rate_limited", "transient"] as const;
export type ConnectorErrorClass = (typeof CONNECTOR_ERROR_CLASSES)[number];

export const LINE_STATUSES = ["pending", "posted", "void"] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

export const DIRECTIONS = ["income", "expense"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Matches public.doc_kind. */
export const DOC_KINDS = [
  "invoice",
  "receipt",
  "invoice_receipt",
  "credit",
  "expense",
  "other",
] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** Matches public.pnl_role. Null when the line has no role yet. */
export const PNL_ROLES = ["project", "shared", "overhead"] as const;
export type PnlRole = (typeof PNL_ROLES)[number];

export const PARTY_KINDS = ["supplier", "customer"] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

/** Matches public.vat_status. Mercury uses amount 0 and status `source`. */
export const VAT_STATUSES = ["source", "derived", "assumed", "unknown"] as const;
export type VatStatus = (typeof VAT_STATUSES)[number];

/** Company display unit. The ₪/$ toggle. Typed inputs stay ILS. */
export const DISPLAY_CURRENCIES = ["ILS", "USD"] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

/**
 * `original` keeps each line in its own currency. Conversion is display-time,
 * from fx_rates. `today` and `historical` store a rate only after a switch.
 */
export const FX_POLICIES = ["original", "today", "historical"] as const;
export type FxPolicy = (typeof FX_POLICIES)[number];
export const DEFAULT_FX_POLICY: FxPolicy = "original";

export const TEXT_LIMITS = {
  externalId: 128,
  description: 2000,
  name: 300,
  hint: 200,
  kind: 64,
  provider: 32,
} as const;

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

export interface ConnectorSchedule {
  daily: "0 3 * * *";
  drain: "*/5 * * * *";
}

export const CONNECTOR_SCHEDULE: ConnectorSchedule = {
  daily: "0 3 * * *",
  drain: "*/5 * * * *",
};

/** id and label only. Never an account number or a routing number. */
export interface AccountLabel {
  id: string;
  label: string;
}

export interface ClassifiedError {
  class: ConnectorErrorClass;
  /** ISO-8601 timestamp, or null when the class has no wait. */
  retry_after: string | null;
}

export type ValidateResult =
  | { ok: true; accounts: AccountLabel[] }
  | ({ ok: false } & ClassifiedError);

declare const sessionBrand: unique symbol;

/**
 * One company's open client. The factory closes over the secret.
 * The registry does not keep a stateful adapter.
 */
export interface ConnectorSession {
  readonly provider: string;
  readonly [sessionBrand]: true;
}

export interface ConnectorFactory {
  open(secret: string): ConnectorSession;
}

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
  /**
   * True only when this response finishes the whole fetch.
   * A single page of a multi-page listing is false.
   */
  complete: boolean;
}

/** A source document the VAT split of a linked row needs. Amounts are minor units. */
export interface LinkedDocument {
  external_id: string;
  gross: number;
  net: number;
  vat_rate_bp: number | null;
}

/** What normalize may read besides the raw payload. No network and no clock. */
export interface NormalizeContext {
  /** Ids from the company's connected accounts, including card and treasury accounts. */
  ownAccountIds: readonly string[];
  /**
   * Owner-set counterparty ids that are the owner's own external accounts.
   * Not account numbers. A transfer with one of these ids is imported, not skipped.
   */
  ownCounterpartyIds: readonly string[];
  /** Company VAT rate in basis points. A bank line ignores it. */
  vatRateBp: number;
  /** Supplier names that are VAT-exempt. This is the match the ledger uses today. */
  exemptSupplierNames: readonly string[];
  /** Supplier external ids that are VAT-exempt, when the supplier has one. */
  exemptSupplierIds: readonly string[];
  /** Documents keyed for linked VAT. A bank fetch passes an empty list. */
  linkedDocuments: readonly LinkedDocument[];
}

/** A named party has a kind. A missing name has a null kind. */
export type Counterparty =
  | { name: string; external_id: string | null; kind: PartyKind }
  | { name: null; external_id: string | null; kind: null };

export interface Vat {
  /** Minor units. Nonnegative. Direction carries the sign of the line. */
  amount: number;
  status: VatStatus;
}

/** Section id or name. Either may be null. The document source matches both. */
export interface ProjectHint {
  external_id: string | null;
  name: string | null;
}

/**
 * Allowlisted provider fields. Anything else, including account numbers,
 * routing numbers, emails, and attachment URLs, is not a field.
 */
export interface ProviderMeta {
  kind?: string | null;
  /**
   * The provider's own category label, when the wire payload has one.
   * Mercury copies raw.mercuryCategory here. Absent for other providers.
   * The L1b brief stores this beside kind. The contract's earlier
   * "kind only" rule is the one the brief replaces.
   */
  providerCategory?: string | null;
}

/**
 * One provider line. amount_original is the gross amount in minor units of
 * `currency` (agorot or cents), nonnegative. Import does not convert a USD
 * line to ILS and does not store a rate. The engine writes signed
 * amount_gross and amount_net in that same currency.
 */
export interface CanonicalLine {
  source: string;
  external_id: string;
  direction: Direction;
  line_status: LineStatus;
  doc_kind: DocKind;
  pnl_role: PnlRole | null;
  currency: string;
  /** Gross minor units. Never a net amount. Nonnegative. */
  amount_original: number;
  /**
   * True when the stored amount_gross is the negation of amount_original.
   * The engine does not infer this from direction or doc_kind.
   */
  amount_negated: boolean;
  doc_date: string;
  cash_date: string | null;
  /** Provider account id. Never an account number or a routing number. */
  source_account_id: string | null;
  counterparty: Counterparty;
  description: string;
  vat: Vat;
  project_hint: ProjectHint | null;
  category_hint: string | null;
  linked_external_id: string | null;
  provider_meta: ProviderMeta;
}

const currencyShape = /^[A-Z]{3}$/;

export const displayCurrencySchema = z.enum(DISPLAY_CURRENCIES);
export const fxPolicySchema = z.enum(FX_POLICIES);

/** Calendar date. Rejects 2026-13-45 and a non-leap 29 February. */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const isoDate = z.string().refine(isIsoDate, { message: "invalid date" });
const boundedId = z.string().min(1).max(TEXT_LIMITS.externalId);
const nullableName = z.string().max(TEXT_LIMITS.name).nullable();

export const providerMetaSchema = z.strictObject({
  kind: z.string().max(TEXT_LIMITS.kind).nullable().optional(),
  providerCategory: z.string().max(TEXT_LIMITS.hint).nullable().optional(),
});

const namedParty = z.strictObject({
  name: z.string().min(1).max(TEXT_LIMITS.name),
  external_id: boundedId.nullable(),
  kind: z.enum(PARTY_KINDS),
});

const unnamedParty = z.strictObject({
  name: z.null(),
  external_id: boundedId.nullable(),
  kind: z.null(),
});

export const canonicalLineSchema = z.strictObject({
  source: z.string().min(1).max(TEXT_LIMITS.provider),
  external_id: boundedId,
  direction: z.enum(DIRECTIONS),
  line_status: z.enum(LINE_STATUSES),
  doc_kind: z.enum(DOC_KINDS),
  pnl_role: z.enum(PNL_ROLES).nullable(),
  currency: z.string().regex(currencyShape),
  amount_original: z.number().int().nonnegative(),
  amount_negated: z.boolean(),
  doc_date: isoDate,
  cash_date: isoDate.nullable(),
  source_account_id: boundedId.nullable(),
  counterparty: z.union([namedParty, unnamedParty]),
  description: z.string().max(TEXT_LIMITS.description),
  vat: z.strictObject({
    amount: z.number().int().nonnegative(),
    status: z.enum(VAT_STATUSES),
  }),
  project_hint: z.strictObject({
    external_id: boundedId.nullable(),
    name: nullableName,
  }).nullable(),
  category_hint: z.string().max(TEXT_LIMITS.hint).nullable(),
  linked_external_id: boundedId.nullable(),
  provider_meta: providerMetaSchema,
});

export function parseCanonicalLine(value: unknown): CanonicalLine {
  return canonicalLineSchema.parse(value);
}

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/**
 * The strict schema and CanonicalLine name the same value.
 * canonicalLineSchema is not annotated as ZodType<CanonicalLine>, so this
 * inference is the object schema. Assigning true fails the build when they differ.
 */
export type CanonicalLineSchemaMatches = Equal<z.infer<typeof canonicalLineSchema>, CanonicalLine>;
const schemaMatchesLine: CanonicalLineSchemaMatches = true;
void schemaMatchesLine;

export type NormalizeResult =
  | { ok: true; line: CanonicalLine }
  | { ok: false; skip: string };

export interface ConnectorPort {
  capabilities: ConnectorCapabilities;
  /** Path prefixes only. Mercury's wrapper also refuses a non-GET method. */
  allowlist: readonly string[];
  validate(session: ConnectorSession): Promise<ValidateResult>;
  fetchSince(session: ConnectorSession, input: FetchSinceInput): Promise<FetchSinceResult>;
  normalize(raw: unknown, ctx: NormalizeContext): NormalizeResult;
  classifyError(error: unknown): ClassifiedError;
  redact(value: unknown): unknown;
}

export interface ConnectorClientDescriptor {
  provider: string;
  nameHe: string;
  icon: string;
  copy: Record<ConnectorCopyKey, string>;
}
