import { useCallback, useRef, useState } from "react";
import { readSetupStore, setupStorageKey, writeSetupStore, type SetupStore } from "./storage";

/** The store for this user and company. A key change reads that key. A null user never writes. */
export function useSetupStore(userId: string | null, companyId: string | null) {
  const key = userId ? setupStorageKey(userId, companyId) : "";
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
  return { store, update };
}
