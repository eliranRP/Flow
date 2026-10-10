// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyStorybookRequest, isAllowedStorybookUrl } from "./storybook-network";

const port = "6193";

describe("isAllowedStorybookUrl", () => {
  it("allows the local storybook origin and data or blob urls", () => {
    expect(isAllowedStorybookUrl("http://127.0.0.1:6193/index.json", port)).toBe(true);
    expect(isAllowedStorybookUrl("http://localhost:6193/iframe.html?id=screens", port)).toBe(true);
    expect(isAllowedStorybookUrl("ws://127.0.0.1:6193/ws", port)).toBe(true);
    expect(isAllowedStorybookUrl("wss://localhost:6193/ws", port)).toBe(true);
    expect(isAllowedStorybookUrl("data:text/plain,hello", port)).toBe(true);
    expect(isAllowedStorybookUrl("blob:http://127.0.0.1:6193/8b0b6b0e-1c1a-4c2a-9c2a-1c1a4c2a9c2a", port)).toBe(true);
  });

  it("blocks supabase hosts, custom domains, and the wrong port", () => {
    expect(isAllowedStorybookUrl("https://fake.supabase.co/functions/v1/flow-mcp/status", port)).toBe(false);
    expect(isAllowedStorybookUrl("wss://fake.supabase.co/realtime/v1/websocket", port)).toBe(false);
    expect(isAllowedStorybookUrl("https://sxqpnetmtufkzowutduq.supabase.co/auth/v1/token", port)).toBe(false);
    expect(isAllowedStorybookUrl("https://abc.supabase.in/auth/v1/token", port)).toBe(false);
    expect(isAllowedStorybookUrl("https://books.example/api", port)).toBe(false);
    expect(isAllowedStorybookUrl("http://127.0.0.1:6194/index.json", port)).toBe(false);
    expect(isAllowedStorybookUrl("http://127.0.0.1/index.json", port)).toBe(false);
    expect(isAllowedStorybookUrl("http://127.0.0.1.supabase.co:6193/", port)).toBe(false);
    expect(isAllowedStorybookUrl("javascript:alert(1)", port)).toBe(false);
    expect(isAllowedStorybookUrl("not a url", port)).toBe(false);
  });
});

describe("classifyStorybookRequest", () => {
  it("names a blocked service-worker request and still allows a local one", () => {
    expect(classifyStorybookRequest("https://fake.supabase.co/sw.js", port, true)).toBe("service-worker");
    expect(classifyStorybookRequest("https://abc.supabase.in/sw.js", port, true)).toBe("service-worker");
    expect(classifyStorybookRequest("https://books.example/sw.js", port, false)).toBe("request");
    expect(classifyStorybookRequest("http://127.0.0.1:6193/sw.js", port, true)).toBe("allow");
  });
});
