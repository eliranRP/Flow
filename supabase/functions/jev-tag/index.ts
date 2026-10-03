import { handleJevTag } from "../_shared/jev_tag.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

Deno.serve((req) => handleJevTag(req, {
  fetch: globalThis.fetch.bind(globalThis),
  env: (name) => Deno.env.get(name) ?? "",
}));
