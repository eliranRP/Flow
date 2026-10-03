// Server-only read of the Jev API key. Decision 0083.
// Vault holds the secret. This module calls the service-role RPC and does not
// read an env var. A missing key fails closed. The RPC name is the only identifier here.

import { JevError, type FetchLike } from "./jev.ts";

export type JevKeySource = {
  fetch: FetchLike;
  supabaseUrl: string;
  serviceKey: string;
};

export async function readJevApiKey(source: JevKeySource): Promise<string> {
  const base = source.supabaseUrl.trim().replace(/\/+$/, "");
  const serviceKey = source.serviceKey.trim();
  if (base === "" || serviceKey === "") throw new JevError("missing_key");

  let response: Response;
  try {
    response = await source.fetch(`${base}/rest/v1/rpc/read_jev_api_key`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: "{}",
    });
  } catch {
    throw new JevError("missing_key");
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new JevError("missing_key", response.status);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new JevError("missing_key", response.status);
  }
  if (typeof parsed !== "string" || parsed.trim() === "") {
    throw new JevError("missing_key", response.status);
  }
  return parsed;
}
