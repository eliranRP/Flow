/**
 * FLOW-804: Flow uses no Supabase realtime or storage, yet supabase-js builds both clients in its
 * constructor, which puts about 80 KB of unused code on Home's first load. vite.config points
 * `@supabase/realtime-js` and `@supabase/storage-js` here. Using either one throws, so a feature
 * that needs them fails loudly and drops the alias. supabase-unused.test.ts checks this file
 * covers every call supabase-js makes on them.
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
