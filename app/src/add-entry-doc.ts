// FLOW-369: a picked file becomes the document the server keeps: its name, type, size and sha256.
// The file is hashed, not read: no receipt reading happens here (FLOW-306).
import type { AttachedDocument } from "./add-entry";

export async function documentOf(file: File): Promise<AttachedDocument> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { name: file.name.trim().slice(0, 200) || "document", mime: file.type, bytes: file.size, sha256 };
}
