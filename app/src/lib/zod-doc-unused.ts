/**
 * FLOW-1215: the code writer behind zod's compiled object parser, which `core/doc.js` exports and
 * `core/index.js` re-exports. zod-jitless.ts turns that parser off before any schema is built
 * (`jit` is false), so nothing constructs one. library-aliases.ts points `./doc.js` here; it has no
 * methods, so a build that did construct one would fail at its first `write`.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- the name zod imports; an empty class is the cheapest stand-in
export class Doc {}
