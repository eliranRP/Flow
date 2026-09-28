import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { InfoIcon, OfflineIcon, RefreshIcon } from "./icons";

type ErrorStateProps = {
  offline: boolean;
  onRetry: () => void;
};

/** Home load failure. Offline follows ld-08. A server failure keeps the band off. */
export function ErrorState({ offline, onRetry }: ErrorStateProps) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <EmptyState
        icon={offline ? <OfflineIcon /> : <InfoIcon size={36} />}
        title={offline ? "אין חיבור לאינטרנט" : "לא הצלחנו לטעון את הנתונים"}
        body={offline ? "בדקו את החיבור ונסו שוב. שום דבר לא נמחק." : "נסו שוב בעוד רגע"}
        action={
          <Button
            variant="pill"
            className="ui-btn-retry"
            icon={<RefreshIcon />}
            onClick={() => {
              onRetry();
            }}
          >
            ניסיון חוזר
          </Button>
        }
      />
    </div>
  );
}
