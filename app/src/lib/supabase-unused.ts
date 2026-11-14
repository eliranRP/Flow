/**
 * FLOW-804: Flow uses neither supabase-js's realtime client nor its storage client (the transaction
 * thread's files call the Storage REST API directly, transaction-thread.ts), yet supabase-js builds
 * both clients in its constructor, which puts about 80 KB of unused code on Home's first load.
 * vite.config points `@supabase/realtime-js` and `@supabase/storage-js` here. Using either one throws, so a feature
 * that needs them fails loudly and drops the alias. supabase-unused.test.ts checks this file
 * covers every call supabase-js makes on them.
 *
 * The same goes for auth-js's WebAuthn (passkey) multi-factor code, about 8 KB minified that
 * GoTrueClient always imports: Flow signs in with Google and magic links and never enrols a
 * factor. vite.config points auth-js's `./lib/webauthn` here; the names below are the ones
 * GoTrueClient imports, and using one throws.
 */

function unused(part: string): Error {
  return new Error(`Supabase ${part} is not in Flow's build. Remove its alias in vite.config.ts to use it.`);
}

export class RealtimeClient {
  setAuth(_token?: string | null): Promise<void> {
    return Promise.resolve();
  }
  channel(..._args: unknown[]): never {
    throw unused("realtime");
  }
  getChannels(): [] {
    return [];
  }
  removeChannel(..._args: unknown[]): Promise<"ok"> {
    return Promise.resolve("ok");
  }
  removeAllChannels(): Promise<[]> {
    return Promise.resolve([]);
  }
}

export class StorageClient {
  from(..._args: unknown[]): never {
    throw unused("storage");
  }
}

export class StorageApiError extends Error {}

export class WebAuthnApi {
  /** GoTrueClient builds one for `mfa.webauthn`; it has no methods here. */
  readonly client: unknown;
  constructor(client?: unknown) {
    this.client = client;
  }
}

export const webAuthnAbortService = {
  createNewAbortSignal(): never {
    throw unused("WebAuthn");
  },
};

export function browserSupportsWebAuthn(): boolean {
  return false;
}

export function createCredential(..._args: unknown[]): never {
  throw unused("WebAuthn");
}
export const getCredential = createCredential;
export const deserializeCredentialCreationOptions = createCredential;
export const deserializeCredentialRequestOptions = createCredential;
export const serializeCredentialCreationResponse = createCredential;
export const serializeCredentialRequestResponse = createCredential;
