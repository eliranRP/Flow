/** A bank or books connection the setup's step 2 can open. */
export type ConnectKind = "mercury" | "sumit";

/**
 * FLOW-514 step 2: where a connection starts. Stand-in until FLOW-512: it opens today's connect sheet
 * for the kind (the step owns the sheets). FLOW-512 swaps this for navigation to /setup/2/<kind>, which
 * mounts ConnectionPage with backTo="/setup/2".
 */
export function openConnection(kind: ConnectKind, open: (kind: ConnectKind) => void): void {
  open(kind);
}
