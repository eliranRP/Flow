import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { CheckIcon } from "../ui/icons";
import { Button } from "../ui/button";
import { ReviewCard } from "../ui/review-card";
import { ScreenHeader } from "../ui/screen-header";
import { useToast } from "../ui/toast";
import { useDashboardQuery } from "../use-books";
import { SAMPLE_TOAST } from "./copy";
import { approveSample } from "./model";
import { readSetupStore, writeSetupStore } from "./storage";

const SAMPLE_TAG = "נתוני דוגמה · Example data";

/**
 * The empty-queue card for `?setup=1`. אישור writes no books row.
 * It stores `sample_review_at` and hands the existing empty state back.
 */
export function SetupSampleReview({
  backTo,
  continueTo,
  empty,
}: {
  backTo: string;
  continueTo: string;
  empty: ReactNode;
}) {
  const { session } = useAuth();
  const dashboard = useDashboardQuery();
  const toast = useToast();
  const navigate = useNavigate();
  const [approved, setApproved] = useState(false);
  const userId = session?.user.id ?? null;
  const companyId = dashboard.data?.company_id ?? null;
  const already = userId != null && companyId != null && readSetupStore(userId, companyId).sample_review_at != null;
  if (approved || already) return <>{empty}</>;

  function approve() {
    if (userId == null || companyId == null) return;
    const at = new Date().toISOString();
    writeSetupStore(userId, companyId, approveSample(readSetupStore(userId, companyId), at));
    setApproved(true);
    toast.show({
      message: SAMPLE_TOAST,
      action: "המשך",
      onAction: () => {
        void navigate(continueTo);
      },
    });
  }

  return (
    <div className="ui-review-queue">
      <ScreenHeader title="לאישור" subtitle="מסמכים שמחכים לשיוך" backTo={backTo} />
      <p className="ui-example-bar t-hint">{SAMPLE_TAG}</p>
      <ReviewCard
        supplier="ספק לדוגמה בע״מ"
        sourceLine="חשבונית · 01/09/2026"
        netAgorot={850_000n}
        vatLine="לפני מע״מ"
      />
      <div className="ui-review-actions">
        <Button full icon={<CheckIcon />} disabled={userId == null || companyId == null} onClick={approve}>
          אישור
        </Button>
      </div>
    </div>
  );
}
