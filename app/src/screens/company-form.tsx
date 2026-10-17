import { flushSync } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactElement, type SubmitEvent } from "react";
import { getSupabase } from "../lib/supabase";
import { SAVE_ERROR } from "../setup/copy";
import { TextField } from "../ui/text-field";
import { useHoldWrites } from "../use-is-viewer";
import { assertNoError, useWrite } from "../use-write";
import { COMPANY_NAME_MAX, companyNameError } from "./rename-company";

/**
 * The company form of the setup's business step (FLOW-506): the name with the create_company rule
 * on the field (FLOW-606) and the create_company write (always registered, FLOW-514: the board has
 * no VAT question). The caller lays out its own page and button.
 */
export function useCompanyForm({
  initialName = "",
  namePlaceholder,
  onCreated,
}: {
  initialName?: string;
  /** FLOW-514: the setup's placeholder, an invented name (never a board sample). */
  namePlaceholder?: string;
  onCreated: (companyId: string) => void;
}): { submit: (event: SubmitEvent<HTMLFormElement>) => void; busy: boolean; holdWrites: boolean; name: string; fields: ReactElement } {
  const client = useQueryClient();
  const holdWrites = useHoldWrites();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | undefined>(undefined);
  const fieldRef = useRef<HTMLInputElement>(null);
  const created = useRef<string | null>(null);
  const save = useWrite({
    failure: SAVE_ERROR,
    keys: ["home", "dashboard", "sumit"],
    onSuccess: () => {
      if (created.current) onCreated(created.current);
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const result = await supabase.rpc("create_company", { p_name: name.trim(), p_vat_registered: true });
      assertNoError(result);
      if (typeof result.data !== "string" || result.data === "") throw new Error("validation");
      created.current = result.data;
      await client.refetchQueries({ queryKey: ["dashboard"], type: "all" });
    },
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    // FLOW-506: the role can turn viewer, or unreadable, while the form is open.
    if (holdWrites || save.isPending) return;
    const problem = companyNameError(name);
    // Commit the message before focus, so the field is announced with it.
    flushSync(() => { setError(problem); });
    if (problem) {
      fieldRef.current?.focus();
      return;
    }
    save.mutate();
  }

  const fields = (
    <>
      <TextField
        ref={fieldRef}
        label="שם העסק"
        placeholder={namePlaceholder}
        value={name}
        maxLength={COMPANY_NAME_MAX * 2 + 20}
        aria-required="true"
        error={error}
        onChange={(event) => {
          setName(event.target.value);
          if (error) setError(undefined);
        }}
        onBlur={() => {
          setError(companyNameError(name));
        }}
      />
    </>
  );

  return { submit, busy: save.isPending, holdWrites, name, fields };
}
