import type { MercuryAccount, MercuryConnection } from "../mercury-state";

/**
 * Mercury connections for the dev routes and the stories (FLOW-938), the board's frames with invented
 * names, digits and balances: one organisation with five accounts, a second with two.
 */

const ACCOUNTS: MercuryAccount[] = [
  { id: "acct-chk", name: "Checking", last4: "4821", kind: "checking", balanceCents: 4_821_000 },
  { id: "acct-sav", name: "Savings", last4: "1093", kind: "savings", balanceCents: 6_250_000 },
  { id: "acct-card", name: "IO Credit", last4: "7710", kind: "credit", balanceCents: -418_200 },
  { id: "acct-pay", name: "Checking ••3307 · Payroll", last4: "3307", kind: "checking", balanceCents: 987_000 },
  { id: "acct-tre", name: "Treasury", last4: "5520", kind: "treasury", balanceCents: 12_000_000 },
];

const NEW_ACCOUNT: MercuryAccount = { id: "acct-new", name: "Checking", last4: "6610", kind: "checking", balanceCents: 0 };

/** The first organisation: connected, three of its five accounts synced. */
export function sampleConnection(overrides: Partial<MercuryConnection> = {}): MercuryConnection {
  return {
    slot: 1,
    org: "Cedar Lane Homes LLC",
    keyWorks: true,
    lastError: null,
    lastSyncAt: "2026-10-20T06:05:00.000Z",
    syncing: false,
    importFrom: null,
    accounts: ACCOUNTS,
    chosen: true,
    synced: ["acct-chk", "acct-sav", "acct-card"],
    skipped: ["acct-pay", "acct-tre"],
    ...overrides,
  };
}

/** Right after the key: the accounts are not chosen yet (step 3). */
export const SAMPLE_PICK: MercuryConnection = sampleConnection({ chosen: false, synced: [], skipped: [], lastSyncAt: null });

/** Mercury lists an account no one answered yet. */
export const SAMPLE_NEW_ACCOUNT: MercuryConnection = sampleConnection({ accounts: [...ACCOUNTS, NEW_ACCOUNT] });

/** A second organisation, both of its accounts synced. */
export const SAMPLE_SECOND: MercuryConnection = {
  slot: 2,
  org: "Cedar Lane Holdings LLC",
  keyWorks: true,
  lastError: null,
  lastSyncAt: "2026-10-20T05:58:00.000Z",
  syncing: false,
  importFrom: "2026-01-01",
  accounts: [
    { id: "acct-hold-ops", name: "Checking", last4: "2264", kind: "checking", balanceCents: 1_532_000 },
    { id: "acct-hold-card", name: "IO Credit", last4: "9081", kind: "credit", balanceCents: -96_400 },
  ],
  chosen: true,
  synced: ["acct-hold-ops", "acct-hold-card"],
  skipped: [],
};

/** The edit list as the board draws it: Savings unchecked, Payroll checked. */
export const SAMPLE_EDIT_SELECTION = ["acct-chk", "acct-card", "acct-pay"];
