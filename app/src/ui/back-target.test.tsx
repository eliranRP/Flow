import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ScrollMemory, useBackTarget } from "./back";
import { ScreenHeader } from "./screen-header";

function MonthPage() {
  const back = useBackTarget("/projects/p1", ["/projects/p1/months"]);
  return (
    <ScreenHeader
      layout="stacked"
      title="הפסד ספטמבר"
      kicker="שיפוץ רחוב הדוגמה 12"
      backTo={back}
      backText={back === "/projects/p1" ? undefined : "לפי חודש"}
    />
  );
}

describe("useBackTarget (FLOW-444)", () => {
  function at(idx: number, path: string) {
    window.history.replaceState({ idx }, "");
    return render(
      <MemoryRouter initialEntries={[path]}>
        <ScrollMemory />
        <MonthPage />
      </MemoryRouter>,
    );
  }

  it("goes back to the by-month list by name, and the page still names its project", () => {
    try {
      at(0, "/projects/p1/months").unmount();
      at(1, "/projects/p1/profit");
      expect(screen.getByRole("button", { name: "חזרה ללפי חודש" })).toHaveTextContent("לפי חודש");
      expect(screen.getByText("שיפוץ רחוב הדוגמה 12", { selector: "p" })).toHaveClass("t-hint");
    } finally {
      window.history.replaceState(null, "");
    }
  });

  it("still names the project when the month opens from the project page", () => {
    try {
      at(0, "/projects/p1").unmount();
      at(1, "/projects/p1/profit");
      expect(screen.getByRole("button", { name: "חזרה לשיפוץ רחוב הדוגמה 12" })).toBeInTheDocument();
      expect(screen.queryByText("שיפוץ רחוב הדוגמה 12", { selector: "p" })).not.toBeInTheDocument();
    } finally {
      window.history.replaceState(null, "");
    }
  });

  it("keeps the icon when Back goes somewhere else", () => {
    try {
      at(0, "/search").unmount();
      at(1, "/projects/p1/profit");
      expect(screen.getByRole("button", { name: "חזרה" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^חזרה לשיפוץ/ })).not.toBeInTheDocument();
    } finally {
      window.history.replaceState(null, "");
    }
  });
});
