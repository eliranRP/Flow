import { describe, expect, it } from "vitest";
import { readSupabaseEnv } from "./supabase";

describe("readSupabaseEnv", () => {
  it("returns null for a URL that is not a URL", () => {
    expect(readSupabaseEnv({ url: "not a url", anonKey: "public" })).toBeNull();
  });

  it("accepts an empty pair so the app can render signed-out", () => {
    expect(readSupabaseEnv({ url: "", anonKey: "" })).toEqual({ url: "", anonKey: "" });
  });
});
