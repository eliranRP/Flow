/** The text as a regular expression that matches it literally (Node 22 has no RegExp.escape). */
export const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
