import { mercuryAdapter } from "./mercury/adapter.ts";
import { MERCURY_CAPABILITIES, MERCURY_KEK_REF } from "./mercury/capabilities.ts";
import { SUMIT_CAPABILITIES, SUMIT_KEK_REF } from "./sumit/capabilities.ts";
import {
  CONNECTOR_SCHEDULE,
  type ConnectorCapabilities,
  type ConnectorFactory,
  type ConnectorPort,
  type ConnectorSchedule,
  type ConnectorSession,
} from "./types.ts";

export const PROVIDERS = ["sumit", "mercury"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export interface ConnectorModule {
  kek_ref: string;
  capabilities: ConnectorCapabilities;
  schedule: ConnectorSchedule;
}

/**
 * L2 adds `open` per provider. The map is not a live client.
 * A company sync calls `open(secret)` and passes that session in.
 */
export interface ConnectorRegistration extends ConnectorModule {
  open: ConnectorFactory["open"];
}

/**
 * Mercury implements the port. SUMIT's normalize lands with the engine.
 * `open` keeps the secret inside the session. CONNECTOR_MODULES stays metadata.
 */
export const mercuryConnector: ConnectorPort & ConnectorFactory = mercuryAdapter;

const registeredPort: ConnectorPort & ConnectorFactory = mercuryConnector;
void registeredPort;

export function openConnector(provider: ProviderId, secret: string): ConnectorSession {
  if (provider === "mercury") return mercuryConnector.open(secret);
  throw new Error("connector_unavailable");
}

export const CONNECTOR_MODULES: Readonly<Record<ProviderId, ConnectorModule>> = {
  sumit: {
    kek_ref: SUMIT_KEK_REF,
    capabilities: SUMIT_CAPABILITIES,
    schedule: CONNECTOR_SCHEDULE,
  },
  mercury: {
    kek_ref: MERCURY_KEK_REF,
    capabilities: MERCURY_CAPABILITIES,
    schedule: CONNECTOR_SCHEDULE,
  },
};
