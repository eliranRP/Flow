const CONTACT = /name|mail|tel|phone|address|street|city|postal|zip|country|user|contact|org|given|family|honorific|nick|bday|sex|url|photo|impp/i;

/** A stable id that iOS will not treat as a contact, username, or address. */
export function flowControlName(prefix: string, generated: string, explicit?: string): string {
  const gen = generated.replace(/[^A-Za-z0-9]/g, "") || "field";
  const cleaned = (explicit ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  if (cleaned.startsWith("split-pct-")) return cleaned;
  if (cleaned !== "" && !CONTACT.test(cleaned)) {
    return cleaned.startsWith("flow-") ? cleaned : `${prefix}-${cleaned}`;
  }
  return `${prefix}-${gen}`;
}
