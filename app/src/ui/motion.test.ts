import { describe, expect, it } from "vitest";
import { pageEnterStyle } from "./motion";

describe("pageEnterStyle", () => {
  it("sets the stagger index as --i", () => {
    expect(pageEnterStyle(2)).toEqual({ "--i": 2 });
  });
});
