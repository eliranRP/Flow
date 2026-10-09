import { flushSync } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type ReactElement, type SubmitEvent } from "react";
import { getSupabase } from "../lib/supabase";
import { SAVE_ERROR, VAT_HINT } from "../setup/copy";
import { SegmentedControl } from "../ui/segmented-control";
import { TextField } from "../ui/text-field";
import { useHoldWrites } from "../use-is-viewer";
import { assertNoError, useWrite } from "../use-write";
import { COMPANY_NAME_MAX, companyNameError } from "./rename-company";

/**
 * The company form shared by onboarding and the setup business step (FLOW-506):
 * the name with the create_company rule on the field (FLOW-606), עוסק מורשה or פטור
 * with its hint, and the create_company write. Each caller lays out its own page and button.
 */
export function useCompanyForm({
  initialName = "",
  checked = false,
  reserveMessage = false,
  blocked,
  onCreated,
}: {
  initialName?: string;
  /** A story opens on a typed name, checked as if the field had been left. */
  checked?: boolean;
  /** Keep the error line's space, so an inline button below does not move. */
  reserveMessage?: boolean;
  /** Preview mode: true when the write must not run. */
  blocked?: () => boolean;
  onCreated: (companyId: string) => void;
}): { submit: (event: SubmitEvent<HTMLFormElement>) => void; busy: boolean; holdWrites: boolean; fields: ReactElement } {
  const client = useQueryClient();
  const holdWrites = useHoldWrites();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState(() => (checked ? companyNameError(initialName) : undefined));
  const fieldRef = useRef<HTMLInputElement>(null);
  const [vat, setVat] = useState<"registered" | "exempt">("registered");
  const hintId = useId();
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
      const result = await supabase.rpc("create_company", { p_name: name.trim(), p_vat_registered: vat === "registered" });
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
    if (blocked?.()) return;
    save.mutate();
  }

  const fields = (
    <>
      <TextField
        ref={fieldRef}
        label="שם העסק"
        value={name}
        maxLength={COMPANY_NAME_MAX * 2 + 20}
        aria-required="true"
        reserveMessage={reserveMessage}
        error={error}
        onChange={(event) => {
          setName(event.target.value);
          if (error) setError(undefined);
        }}
        onBlur={() => {
          setError(companyNameError(name));
        }}
      />
      <SegmentedControl
        label="סוג העסק"
        describedBy={hintId}
        value={vat}
        onChange={setVat}
        options={[
          { value: "registered", label: "עוסק מורשה" },
          { value: "exempt", label: "עוסק פטור" },
        ]}
      />
      <p id={hintId} className="t-hint">{vat === "registered" ? VAT_HINT.registered : VAT_HINT.exempt}</p>
    </>
  );

  return { submit, busy: save.isPending, holdWrites, fields };
}
