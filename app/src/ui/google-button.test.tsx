import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GoogleButton } from "./google-button";
import { expectRtl, expectTarget } from "./test-support";

describe("GoogleButton", () => {
  it("keeps the exact Hebrew label and a 44px target", () => {
    expectRtl();
    render(<GoogleButton pending={false} disabled onClick={() => undefined} />);
    const button = screen.getByRole("button", { name: "המשך עם Google" });
    expect(button).toBeDisabled();
    expectTarget(button);
  });
});
