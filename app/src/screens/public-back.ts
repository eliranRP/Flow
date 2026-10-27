import { useAuth } from "../auth";

/**
 * FLOW-977: where חזרה goes on a page anyone can open (help, terms, privacy) when there is no app
 * history to pop. Signed out it is sign-in; a signed-in owner goes Home, not back to sign-in.
 */
export function usePublicBackTarget(): string {
  return useAuth().status === "authed" ? "/" : "/sign-in";
}
