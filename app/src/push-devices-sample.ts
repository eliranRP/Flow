import type { PushDevice } from "./push-devices";

/** Invented connected devices for stories and the dev route: an iPhone (this device) and Chrome on a computer. */
export const SAMPLE_DEVICES: PushDevice[] = [
  { id: "device-1", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1", createdAt: "2026-10-20T08:00:00.000Z", tag: "aaaaaaaaaaaaaaaa" },
  { id: "device-2", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", createdAt: "2026-10-09T08:00:00.000Z", tag: "bbbbbbbbbbbbbbbb" },
];

export const SAMPLE_THIS_TAG = "aaaaaaaaaaaaaaaa";
