import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecurringAskBox, RecurringMatchBox } from "./recurring-match-box";
import { topToast } from "./top-toast";

describe("Recurring v2: the answers (FLOW-963)", () => {
  it("are two buttons of the same kind, and the match's no says what it means", () => {
    render(
      <>
        <RecurringAskBox text="לא שולם" hint="" onStill={() => undefined} onEnded={() => undefined} />
        <RecurringMatchBox name="Other" amount="$1" date="08/10" income={false} onYes={() => undefined} onNo={() => undefined} />
      </>,
    );
    const ask = screen.getByRole("region", { name: "עדיין קבוע?" });
    const [still, ended] = within(ask).getAllByRole("button");
    expect(still?.className.replace("ui-recurring-match-yes", "")).toBe(ended?.className.replace("ui-recurring-match-no", ""));
    expect(screen.getByRole("button", { name: "לא, זה משהו אחר" })).toBeTruthy();
  });

  it("the match's third answer ignores the bill this month, when the page offers it (V3-Charge)", () => {
    render(<RecurringMatchBox name="Other" amount="$1" date="08/10" income={false} onYes={() => undefined} onNo={() => undefined} onIgnore={() => undefined} />);
    expect(screen.getByRole("region", { name: "אולי הגיע בשם אחר?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "התעלמות החודש" })).toBeTruthy();
  });
});

describe("Recurring v2: the toasts (decision 0215)", () => {
  it("hang under the header; an undo stays 5s, a note 4s", () => {
    expect(topToast({ message: "x", action: "ביטול", onAction: () => undefined })).toMatchObject({ place: "top", durationMs: 5000 });
    expect(topToast({ message: "x" })).toMatchObject({ place: "top", durationMs: 4000 });
  });
});
