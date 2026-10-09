import { handlePushSend } from "../_shared/push_send.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

Deno.serve((req) => handlePushSend(req, {
  fetch: globalThis.fetch.bind(globalThis),
  env: (name) => Deno.env.get(name) ?? "",
}));
