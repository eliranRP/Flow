import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "./avatar";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

describe("Avatar", () => {
  it("is a 44px tinted initial in both themes", () => {
    expectRtl();
    render(<Avatar name="אלירן" />);
    const avatar = screen.getByRole("img", { name: "אלירן" });
    expect(avatar).toHaveTextContent("א");
    expectTarget(avatar);
    expectThemePaint(avatar, "backgroundColor");
  });
});
