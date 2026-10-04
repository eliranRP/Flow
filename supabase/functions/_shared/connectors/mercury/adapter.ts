import { MERCURY_GET_ALLOWLIST } from "./allowlist.ts";
import { MERCURY_CAPABILITIES } from "./capabilities.ts";
import {
  classifyMercuryError,
  fetchMercurySince,
  openMercury,
  validateMercury,
} from "./client.ts";
import { normalizeMercury } from "./normalize.ts";
import { redactMercury } from "./redact.ts";
import type { ConnectorFactory, ConnectorPort } from "../types.ts";

/** Mercury ConnectorPort. The secret stays inside the session opened by `open`. */
export const mercuryAdapter = {
  capabilities: MERCURY_CAPABILITIES,
  allowlist: MERCURY_GET_ALLOWLIST,
  open: openMercury,
  validate: validateMercury,
  fetchSince: fetchMercurySince,
  normalize: normalizeMercury,
  classifyError: classifyMercuryError,
  redact: redactMercury,
} satisfies ConnectorPort & ConnectorFactory;
