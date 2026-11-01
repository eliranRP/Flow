# Cheat sheet — open this first

Every number below is copied from the rule files (no new numbers). "reel demo" = shown in a Design Motion reel example, illustrative not a law. "(standard, not from Design Motion)" = industry standard (e.g. WCAG). Follow the file § for the full rule, schema and how-to-check.

## Key numbers

| Value | Rule | File § |
|---|---|---|
| < 100 ms | Visual feedback on every press | feedback-and-states § 1 |
| ≤ 400 ms | Some response (Doherty threshold) | feedback-and-states § 1 |
| < 300 ms show nothing; < 3 s spinner; > 3 s progress bar | Loading pattern by wait | feedback-and-states § 2 |
| 0 ms result, sync ≈ 300 ms behind (reel demo) | Optimistic UI, reversible actions only | motion § 9 / feedback Quick numbers |
| info 4 s, warning 7 s, error until acknowledged; max 3 visible | Toasts | feedback-and-states § 9 |
| 10 s grace with countdown | Undo for "send" | feedback-and-states § 10 |
| 300 ms hold (reel demo) | Hold-to-delete | feedback-and-states § 11, hierarchy § 11 |
| 800 ms debounce | Autosave | feedback-and-states § 12 |
| same frame; reset after 2 s | Copy-to-clipboard confirmation | feedback-and-states § 14 |
| 250 ms ease-out; width = 2× knob | Switch morph | feedback-and-states § 15, motion § 6 |
| 300 ms delay, one sentence ≤ 300 px | Tooltips | feedback-and-states § 19 |
| 200–300 ms ease-out (250 perfect; 50 too fast, 700 too slow); exits faster (250 in → 150 out) | Entrances / exits | motion § 1 |
| 500–800 ms + bounce | Rare attention motion | motion § 3 |
| ~50 ms (30 blurs, 100 crawls) | List stagger | motion § 4 |
| ~8 px, ~200 ms ease-out | Hover lift | motion § 7 |
| 1.4 px/ms velocity, 80 px distance; snaps 15% / 50% / 92% (reel demo) | Gestures / bottom sheet | motion § 11, hierarchy § 10 |
| scale 1.03, +8 px shadow, 3° tilt (reel demo) | Drag lift | motion § 12 |
| 10 updates/s → 60 fps interpolated | Real-time multiplayer | motion § 14 |
| 1 | Primary action per view; highlighted pricing tier | hierarchy § 1, § 8 |
| ~12 px in group vs ~40 px between groups | Proximity grouping | hierarchy § 5 |
| 3–5 bottom tabs; sidebar at 5+; breadcrumbs when depth > 2 | Navigation | hierarchy § 12, tables § 23 |
| drawer min 320 px, max 40% width (reel demo); 1 open sheet | Containers | hierarchy § 10 |
| 1 question before value; start checklist at 1/3; 1 coach mark (3 = nobody reads) | Onboarding | onboarding § 2, § 3, § 4 |
| 1 icon + 1 primary button | Empty state | onboarding § 6 |
| 6 digits; resend 30 s | OTP | forms § 9 |
| groups of 4; brand on digit 1; stored with 0 separators | Card number formatting | forms § 8 |
| radios ≤ 5; search at ≥ 10 items; dropdown open 150 ms | Selection controls | forms § 11, § 13 |
| ≥ 44 px | Touch targets / row hit area (also platform standard, not from Design Motion originally) | tables § 21, forms § 11, visual § 8 |
| 12 fields → 4 steps, "Step n/4" | Long forms | forms § 15 |
| "kills 80% of errors" | Inline validation | feedback-and-states § 7, forms § 4 |
| 0 "Submit"/"OK" primary buttons | Microcopy | forms § 6 |
| < 640 px (container < ~700 px) → 2-line cards; check at 375 px | Responsive tables | tables § 1 |
| `text-align:right; tabular-nums` | Numeric columns | tables § 7 |
| Compact 40 / Default 48 px (pattern page 36/48/60) | Row height | tables § 9 |
| stripes only at ~12 columns | Row separators | tables § 8 |
| 30-char name stress test; fixtures empty / 1 / 40 chars + emoji | Real content | tables § 12, feedback § 4 |
| big number cap ~30 px | Big numbers in cards | tables § 19 |
| inputs ≥ 16 px (14 px zooms) | Mobile inputs | tables § 20 |
| 12 → 6 → 4 → 1 columns | Grid | tables § 27 |
| pie max 5 slices; ~12 series → table | Charts | data-viz § 5, § 6 |
| ~8% colour-vision deficiency | Never colour alone | data-viz § 10 |
| 4 px base; flag 7 / 11 / 23 px; 1.618 (61.8/38.2) | Spacing scales | visual § 2 |
| 5 sizes, 3 inks, 2 weights (400/600) | Typography | visual § 3 |
| radius 4 / 8 / 12 / 16 / 24 by element size | Corners | visual § 5 |
| 4.5:1 text, 3:1 UI (standard, not from Design Motion — WCAG) | Contrast | visual § 7 |
| 1 px rgba(255,255,255,.08) hairline; 3 surface values | Dark mode depth | visual § 10, § 11 |
| 13 px text, 32 px rows (reel demo) | Dense tools | visual § 12 |
| 2 px stroke; 24 px grid (16 dense) | Icons | visual § 13 |

## Top 15 review checks

1. One primary action per screen; accent colour used only on it (hierarchy § 1–2).
2. Every press reacts < 100 ms; every action responds ≤ 400 ms (feedback § 1).
3. Empty, loading, error, offline, long-data states all designed (feedback § 4).
4. Errors say what happened and how to fix; buttons name the outcome (forms § 6, feedback § 6).
5. Labels persistent above fields; no placeholder-only labels (forms § 2).
6. Validate on blur, then live; don't disable submit without explanation (forms § 4–5, feedback § 16).
7. Undo instead of "Are you sure?"; friction matches destructive cost (feedback § 10–11).
8. Optimistic UI only for reversible actions, with rollback (motion § 9).
9. Tables become 2-line cards on mobile; numbers right-aligned tabular (tables § 1, § 7).
10. Touch targets ≥ 44 px; inputs ≥ 16 px on mobile (tables § 20–21).
11. Container fits stakes: sheet/drawer/page before modal (hierarchy § 10).
12. Empty states have icon, human copy, one action; zero results never a dead end (onboarding § 6, § 8).
13. Motion 200–300 ms ease-out, exits faster, reduced motion respected (motion § 1, § 15).
14. Contrast 4.5:1 / 3:1, visible focus, real semantics and keyboard (visual § 7–9).
15. Spacing, type, radius and colour come from tokens/scales — no off-scale values (visual § 1–5).
