import { describe, expect, it } from "vitest";
import { initialsOf } from "./initials";

describe("initialsOf (FLOW-305)", () => {
  it("takes two Hebrew words", () => {
    expect(initialsOf("חשמל השרון")).toEqual({ text: "חה", dir: "rtl" });
  });

  it("takes two Latin words, upper-cased", () => {
    expect(initialsOf("northwind traders")).toEqual({ text: "NT", dir: "ltr" });
  });

  it("drops legal suffixes", () => {
    expect(initialsOf("שיש הגליל בע״מ")).toEqual({ text: "שה", dir: "rtl" });
    expect(initialsOf('בטון בע"מ')).toEqual({ text: "ב", dir: "rtl" });
    expect(initialsOf("Contoso Ltd.")).toEqual({ text: "C", dir: "ltr" });
    expect(initialsOf("Fabrikam, Inc")).toEqual({ text: "F", dir: "ltr" });
    expect(initialsOf("Acme LLC")).toEqual({ text: "A", dir: "ltr" });
  });

  it("maps Hebrew final forms to the base letter", () => {
    expect(initialsOf("ןמ צבע")).toEqual({ text: "נצ", dir: "rtl" });
  });

  it("uses one letter when the script changes", () => {
    expect(initialsOf("Mercury בנק")).toEqual({ text: "M", dir: "ltr" });
    expect(initialsOf("חשמל IEC")).toEqual({ text: "ח", dir: "rtl" });
  });

  it("skips digits and symbols", () => {
    expect(initialsOf("1234 #Paz 99 Yellow")).toEqual({ text: "PY", dir: "ltr" });
  });

  it("returns null when there is no letter", () => {
    expect(initialsOf("4242-1234")).toBeNull();
    expect(initialsOf("")).toBeNull();
    expect(initialsOf(null)).toBeNull();
  });

  it("keeps a name that is only a suffix word", () => {
    expect(initialsOf("Co")).toEqual({ text: "C", dir: "ltr" });
  });
});
