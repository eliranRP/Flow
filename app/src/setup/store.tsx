import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { usePreviewMode } from "../preview";
import { loadSetupStore, readSetupStore, setupStorageKey, writeSetupStore, type SetupStore } from "./storage";

/**
 * The store for this user and company. A key change reads that key. A null user never writes.
 * `ready` turns true once the server copy has settled the local one (FLOW-506), so the one
 * automatic resume never decides from a new phone's empty copy.
 */
export function useSetupStore(userId: string | null, companyId: string | null) {
  const preview = usePreviewMode();
  const key = userId ? setupStorageKey(userId, companyId) : "";
  const live = !preview && userId != null && companyId != null;
  const server = useQuery({
    queryKey: ["setup-state", userId, companyId],
    enabled: live,
    queryFn: () => loadSetupStore(userId as string, companyId as string),
    staleTime: Infinity,
    retry: false,
  });
  const [local, setLocal] = useState<{ key: string; store: SetupStore } | null>(null);
  const stored = readSetupStore(userId, companyId);
  const store = local?.key === key ? local.store : stored;
  const storeRef = useRef(store);
  storeRef.current = store;
  const update = useCallback((recipe: (current: SetupStore) => SetupStore) => {
    if (!userId) return;
    const next = recipe(storeRef.current);
    writeSetupStore(userId, companyId, next);
    setLocal({ key: setupStorageKey(userId, companyId), store: next });
  }, [userId, companyId]);
  return { store, update, ready: !live || server.isFetched };
}
