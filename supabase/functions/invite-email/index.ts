import { handleInviteEmail } from "../_shared/invite_email.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

Deno.serve((req) => handleInviteEmail(req, {
  fetch: globalThis.fetch.bind(globalThis),
  env: (name) => Deno.env.get(name) ?? "",
}));
