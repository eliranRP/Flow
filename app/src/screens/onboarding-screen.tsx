import { useNavigate, useSearchParams } from "react-router-dom";
import { useWriteGate } from "../use-is-viewer";
import { keepPreview, usePreviewSearch } from "../preview";
import { safeAppPath } from "../safe-return";
import { Button } from "../ui/button";
import { ScreenHeader } from "../ui/screen-header";
import { useCompanyForm } from "./company-form";
import { useBlockedPreview } from "./screen-shared";

/** `initialName` lets a story open on a typed name, checked as if the field had been left. */
export function OnboardingScreen({ initialName }: { initialName?: string } = {}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const blocked = useBlockedPreview();
  const previewSearch = usePreviewSearch();
  const returnPath = safeAppPath(params.get("return")) ?? "/";
  const returnTo = keepPreview(returnPath, previewSearch);
  const writeGate = useWriteGate(returnPath);
  const form = useCompanyForm({
    initialName,
    checked: initialName != null,
    reserveMessage: true,
    blocked,
    onCreated: () => {
      void navigate(returnTo, { replace: true });
    },
  });

  if (writeGate === "wait") return null;
  if (writeGate !== "show") return writeGate;
  // One form, so no step meter (FLOW-356): setup step 0 shows the same form with none.
  return (
    <main className="ui-onboard">
      <ScreenHeader title="פרטי העסק" subtitle="השם שיופיע בבית." backTo={returnTo} />
      <form className="ui-page-pad" onSubmit={form.submit}>
        {form.fields}
        <Button type="submit" busy={form.busy} disabled={form.holdWrites}>המשך</Button>
      </form>
    </main>
  );
}
