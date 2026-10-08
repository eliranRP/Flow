import { flushSync } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type SubmitEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useHoldWrites, useWriteGate } from "../use-is-viewer";
import { getSupabase } from "../lib/supabase";
import { keepPreview, usePreviewSearch } from "../preview";
import { safeAppPath } from "../safe-return";
import { assertNoError, useWrite } from "../use-write";
import { COMPANY_NAME_MAX, companyNameError } from "./rename-company";
import { Button } from "../ui/button";
import { ProgressBar } from "../ui/progress-bar";
import { ScreenHeader } from "../ui/screen-header";
import { SegmentedControl } from "../ui/segmented-control";
import { TextField } from "../ui/text-field";
import { useBlockedPreview } from "./screen-shared";

/** `initialName` lets a story open on a typed name, checked as if the field had been left. */
export function OnboardingScreen({ initialName }: { initialName?: string } = {}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const blocked = useBlockedPreview();
  const holdWrites = useHoldWrites();
  const [name, setName] = useState(initialName ?? "");
  const [nameError, setNameError] = useState(() => (initialName == null ? undefined : companyNameError(initialName)));
  const nameRef = useRef<HTMLInputElement>(null);
  const [vat, setVat] = useState<"registered" | "exempt">("registered");
  const previewSearch = usePreviewSearch();
  const returnPath = safeAppPath(params.get("return")) ?? "/";
  const returnTo = keepPreview(returnPath, previewSearch);
  const writeGate = useWriteGate(returnPath);
  const save = useWrite({
    failure: "לא הצלחנו לשמור.",
    keys: ["home", "dashboard", "sumit"],
    onSuccess: () => {
      void navigate(returnTo, { replace: true });
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("create_company", { p_name: name.trim(), p_vat_registered: vat === "registered" }));
      await client.refetchQueries({ queryKey: ["dashboard"], type: "all" });
    },
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (holdWrites || save.isPending) return;
    // The create_company rule (FLOW-606), on the field instead of a save toast.
    const problem = companyNameError(name);
    // Commit the message before focus, so the field is announced with it.
    flushSync(() => { setNameError(problem); });
    if (problem) {
      nameRef.current?.focus();
      return;
    }
    if (blocked()) return;
    save.mutate();
  }

  const step = 1;
  const steps = 1;
  if (writeGate === "wait") return null;
  if (writeGate !== "show") return writeGate;
  return (
    <main className="ui-onboard">
      <div className="ui-progress-row">
        <ProgressBar
          variant="slim"
          value={step}
          max={steps}
          label={`שלב ${String(step)} מתוך ${String(steps)}`}
          caption={
            <span className="t-hint">
              שלב <bdi className="ui-num" dir="ltr">{String(step)}</bdi> מתוך <bdi className="ui-num" dir="ltr">{String(steps)}</bdi>
            </span>
          }
        />
      </div>
      <ScreenHeader title="פרטי העסק" subtitle="השם שיופיע בבית." backTo={returnTo} />
      <form className="ui-page-pad" onSubmit={submit}>
        <TextField
          ref={nameRef}
          label="שם העסק"
          value={name}
          maxLength={COMPANY_NAME_MAX * 2 + 20}
          aria-required="true"
          reserveMessage
          error={nameError}
          onChange={(event) => {
            setName(event.target.value);
            if (nameError) setNameError(undefined);
          }}
          onBlur={() => {
            setNameError(companyNameError(name));
          }}
        />
        <SegmentedControl
          label="סוג העסק"
          value={vat}
          onChange={setVat}
          options={[
            { value: "registered", label: "עוסק מורשה" },
            { value: "exempt", label: "עוסק פטור" },
          ]}
        />
        <p className="t-hint">עוסק מורשה: מע״מ 18%.</p>
        <Button type="submit" busy={save.isPending} disabled={holdWrites}>המשך</Button>
      </form>
    </main>
  );
}
