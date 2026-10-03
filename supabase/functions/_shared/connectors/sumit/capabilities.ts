import type { ConnectorCapabilities } from "../types.ts";

/** Env name of the SUMIT key-encryption key. The value is never in the repo. */
export const SUMIT_KEK_REF = "SUMIT_KEK";

export const SUMIT_CAPABILITIES: ConnectorCapabilities = {
  listing: "full",
  removal: "sweep",
  currencies: ["ILS"],
  hasPending: false,
};
