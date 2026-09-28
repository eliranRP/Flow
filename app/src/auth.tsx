import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "./lib/supabase";

export type AuthStatus = "loading" | "anon" | "authed" | "unconfigured";

type AuthValue = {
  status: AuthStatus;
  session: Session | null;
};

const AuthContext = createContext<AuthValue>({ status: "loading", session: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase();
  const [value, setValue] = useState<AuthValue>({
    status: supabase ? "loading" : "unconfigured",
    session: null,
  });

  useEffect(() => {
    if (!supabase) {
      setValue({ status: "unconfigured", session: null });
      return;
    }
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setValue({ status: session ? "authed" : "anon", session });
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  const stable = useMemo(() => value, [value]);
  return <AuthContext.Provider value={stable}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}
