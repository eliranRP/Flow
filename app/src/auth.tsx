import { useQueryClient } from "@tanstack/react-query";
import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "./lib/supabase";
import { dropJevConnectorForAuthChange, noteJevAuthUser } from "./screens/jev-review";
import { forgetCompanyRole, keepOnlyCompanyRole } from "./company-role-cache";

export type AuthStatus = "loading" | "anon" | "authed" | "unconfigured";

type AuthValue = {
  status: AuthStatus;
  session: Session | null;
};

const AuthContext = createContext<AuthValue>({ status: "loading", session: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase();
  const queryClient = useQueryClient();
  const seenUser = useRef<string | null>(null);
  const [value, setValue] = useState<AuthValue>({
    status: supabase ? "loading" : "unconfigured",
    session: null,
  });
  // Remounts the app when the user changes, so no screen keeps the last user's data or drafts.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!supabase) {
      setValue({ status: "unconfigured", session: null });
      return;
    }
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextId = session?.user.id ?? null;
      const previous = seenUser.current;
      seenUser.current = nextId;
      noteJevAuthUser(nextId);
      // Also covers a session that ended while no tab was open: no "previous" here.
      keepOnlyCompanyRole(nextId);
      if (previous != null && previous !== nextId) {
        // Sign-out, an expired session, another tab, or a user switch. The
        // query keys don't name the user, so nothing cached may outlive them.
        dropJevConnectorForAuthChange();
        forgetCompanyRole(previous);
        queryClient.clear();
        setGeneration((count) => count + 1);
      }
      setValue({ status: session ? "authed" : "anon", session });
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, queryClient]);

  const stable = useMemo(() => value, [value]);
  return (
    <AuthContext.Provider value={stable}>
      <Fragment key={generation}>{children}</Fragment>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}
