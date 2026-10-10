import { useNavigate, useSearchParams } from "react-router-dom";
import { useWriteGate } from "../use-is-viewer";
import { keepPreview, usePreviewSearch } from "../preview";
import { safeAppPath } from "../safe-return";
import { Button } from "../ui/button";
import { ProgressBar } from "../ui/progress-bar";
import { ScreenHeader } from "../ui/screen-header";
import { useOpenCompany } from "../team-queries";
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
  const openCompany = useOpenCompany();
  const form = useCompanyForm({
    initialName,
    checked: initialName != null,
    reserveMessage: true,
    blocked,
    onCreated: (companyId) => {
      // FLOW-601: create_company opened the new company; show it, and drop the last one's cached rows.
      void openCompany(companyId, { opened: true }).catch(() => undefined);
      void navigate(returnTo, { replace: true });
    },
  });

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
      <form className="ui-page-pad" onSubmit={form.submit}>
        {form.fields}
        <Button type="submit" busy={form.busy} disabled={form.holdWrites}>המשך</Button>
      </form>
    </main>
  );
}
