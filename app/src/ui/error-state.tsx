import { Button } from "./button";

type ErrorStateProps = {
  offline: boolean;
  onRetry: () => void;
};

/**
 * A failure is one line and the retry (FLOW-371, REDESIGN-BUILD: "a failure shows one line with
 * נסו שוב"). Offline names the connection. The retry is the 44px link, not a block of its own.
 */
export function ErrorState({ offline, onRetry }: ErrorStateProps) {
  return (
    <div className="ui-failure" role="status">
      <span>{offline ? "אין חיבור לאינטרנט." : "לא הצלחנו לטעון."}</span>
      <Button
        variant="link"
        onClick={() => {
          onRetry();
        }}
      >
        נסו שוב
      </Button>
    </div>
  );
}
