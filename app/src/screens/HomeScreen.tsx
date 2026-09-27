import { useQuery } from "@tanstack/react-query";
import { usePreviewMode } from "../preview";
import { supabase, supabaseConfigured } from "../lib/supabase";

export function HomeScreen() {
  const preview = usePreviewMode();
  const session = useQuery({
    queryKey: ["session"],
    enabled: !preview && supabaseConfigured && supabase != null,
    queryFn: async () => {
      if (!supabase) return null;
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session;
    },
  });

  const home = useQuery({
    queryKey: ["home", session.data?.user.id],
    enabled: !preview && session.data != null && supabase != null,
    queryFn: async () => {
      if (!supabase) return null;
      const { data, error } = await supabase.rpc("get_home");
      if (error) throw error;
      return data as { name?: string; net_profit_agorot?: number } | null;
    },
  });

  const companyName =
    home.data && typeof home.data === "object" && "name" in home.data
      ? String(home.data.name ?? "")
      : "";

  return (
    <div>
      <header className="rounded-b-band bg-band px-6 pb-10 pt-[max(2rem,env(safe-area-inset-top))] text-on-band">
        <p className="text-[22px] font-bold leading-none">Flow</p>
        {companyName ? (
          <p className="mt-2 text-[15px] text-on-band-secondary">{companyName}</p>
        ) : null}
        <p className="mt-8 text-[15px] text-on-band-secondary">הרווח החודש</p>
        <p className="mt-1 text-[52px] font-semibold leading-none">₪0</p>
        <p className="mt-3 text-[13px] text-on-band-secondary">לפני מע״מ · מזומן</p>
      </header>

      <section className="px-6 py-8">
        {home.isError ? (
          <p className="text-bad">לא הצלחנו לטעון את הבית. נסו שוב בעוד רגע.</p>
        ) : (
          <div className="rounded-card border border-line bg-surface px-4 py-6">
            <h1 className="text-[17px] font-semibold">עדיין אין תנועות</h1>
            <p className="mt-2 text-[15px] font-normal leading-relaxed text-text-secondary">
              אחרי החיבור ל-SUMIT, ההכנסות וההוצאות יופיעו כאן לפי פרויקט. הסכום הגדול
              נשאר רווח נקי של העסק.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
