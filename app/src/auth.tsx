import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "./lib/supabase";
import { bindJevConnectorScope, dropLegacyJevConnectorKey } from "./screens/jev-review";

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

  useEffect(() => {
    dropLegacyJevConnectorKey();
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
      if (previous != null && nextId == null) {
        bindJevConnectorScope(null);
        queryClient.removeQueries({ queryKey: ["jev-connector"] });
      }
      setValue({ status: session ? "authed" : "anon", session });
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, queryClient]);

  const stable = useMemo(() => value, [value]);
  return <AuthContext.Provider value={stable}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}
