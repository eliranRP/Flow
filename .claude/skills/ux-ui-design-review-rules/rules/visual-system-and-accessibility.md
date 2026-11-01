# Tokens, visual system and accessibility

Rules sourced from Design Motion (designmotionhq.com patterns + Design Motion reels). Anything marked **(standard, not from Design Motion)** is a widely used industry standard added for completeness. Numbers marked "reel demo" are values shown in a reel example.

---

### 1. Semantic tokens, three layers

**Rule** Primitives → semantic → component. Name tokens by meaning (`color-primary`, `text-muted`), not value (`blue-500`). No raw hex/px inline in components.

**Why** Changing the brand colour should be one edit, not 47.

**Schema**
```
primitive   blue-600 = #2F5BEA
semantic    color-primary = {blue-600}
component   button-bg = {color-primary}
```

**Good vs Bad**
```css
/* Bad */  .btn { background:#2F5BEA; padding:7px 13px; }
/* Good */ .btn { background:var(--button-bg); padding:var(--space-2) var(--space-3); }
```

**How to check** `grep -rE '#[0-9a-fA-F]{3,8}|[0-9]+px'` in component code (outside token files). Any hit = finding.

**Source** https://designmotionhq.com/patterns/design-tokens · https://designmotionhq.com/patterns/design-system-kit

---

### 2. Snap to scales (spacing, ratio, layout split)

**Rule** Spacing on a 4px scale; never arbitrary gaps. Optionally derive steps with the golden ratio (×1.618) and round to clean grid values. Split two-column layouts ~62/38, giving the larger share to primary content.

**Numbers** 4px base. Off-scale examples to flag: **7px, 11px, 23px**. Golden ratio **1.618**; split **61.8% / 38.2%** (≈62/38); type example **16px body → 26px** next step. Don't let the ratio fight an existing 8px grid.

**Schema**
```
┌──────────── 62% ────────────┬──── 38% ────┐
│ primary content             │ secondary   │
```

**How to check** Collect all margin/padding/gap values; any not divisible by 4 = finding.

**Source** https://designmotionhq.com/patterns/design-system-kit · https://designmotionhq.com/patterns/golden-ratio · https://www.facebook.com/reel/1242263874610523

---

### 3. Typography is a system (new, from reel)

**Rule** Seven decisions, one font:
1. **Sizes**: five sizes on one ratio — not ten ad-hoc sizes.
2. **Inks**: three text colours — primary (the amount, the thing), secondary (still readable), muted (dates, metadata).
3. **Weights**: two — **400** and **600**.
4. **Leading moves against size**: big text gets tighter line-height, small text looser.
5. **Tracking**: tighten above **24px**; open up small caps/uppercase labels below **16px**.
6. **Measure**: cap line length in `ch` on the text, not by the container width (demo container **1400px**).
7. **Tabular figures** for numbers in tables/KPIs (see rule 4).

**Numbers** Sizes **5**, inks **3**, weights **2** (400/600), tracking thresholds **>24px** / **<16px**.

**Good vs Bad**
```css
/* Good */
h1 { font-size:32px; font-weight:600; line-height:1.15; letter-spacing:-0.02em; }
.label-caps { font-size:12px; text-transform:uppercase; letter-spacing:0.06em; }
p { max-width:65ch; } /* 65ch is a common default, (standard, not from Design Motion) */
/* Bad: 11 font sizes, weights 300/400/500/600/700/800, body text running 1400px wide */
```

**How to check** Count distinct font-size, font-weight and text colour values in the CSS of one screen: > 5 / > 2 / > 3 = finding. Paragraph with no max-width on wide screens = finding.

**Source** https://www.facebook.com/reel/1077130178294248

---

### 4. Format numbers like a system (new, from reel)

**Rule**
- `font-variant-numeric: tabular-nums` wherever numbers stack or update.
- **Right-align numbers, left-align text** in tables.
- **Abbreviate big values** (3,400,000 → 3.4M), exact value on hover.
- **Relative time under a day** ("2h ago"), absolute date for anything older.
- **Currency**: pin the symbol and align decimals; same number of decimals in a column.

**Schema**
```
Item          Price         BAD:  $1,000.00
Nordic Chair  $1,299.00           $9.99
Oak Desk        $980.00           $250.00
```

**Good vs Bad**
```css
td.num { text-align:right; font-variant-numeric: tabular-nums; }
```

**How to check** Number columns not right-aligned or not tabular = finding. "14:32" timestamps older than a day without a date, or "3 days ago" mixed with absolute dates inconsistently = finding.

**Source** https://www.facebook.com/reel/28747148424888259 · https://www.facebook.com/reel/1077130178294248

---

### 5. Corners are a system (border radius)

**Rule**
1. **Nested**: inner radius = outer radius − padding.
2. **Scale**: radius follows element size — not `8px` on everything.
3. **Pill**: full radius is a shape (`9999px`), not a number to tune.
4. **Edges**: an element touching a screen edge gets no corner there.
5. **Ring**: an outline/selection ring's radius = inner radius + gap.
6. **Images**: let the card clip the image (`overflow:hidden`) so no corner pokes out.

**Numbers** Pattern page scale: tooltip **~4px**, input **~8px**, card **~12px**, modal **~16px**, panel **~24px**. Reel scale tokens: sm **4**, md **8**, lg **12**, xl **16**, full **9999**.

**Schema**
```
outer 16px ┌───────────────┐
           │ pad 8  ┌─────┐│  inner = 16 − 8 = 8px
           │        └─────┘│
           └───────────────┘
```

**How to check** For each nested pair compute outer − padding vs inner; mismatch = finding. Single radius used for every element = finding. Full-bleed mobile cards with rounded corners at the screen edge = finding.

**Source** https://designmotionhq.com/patterns/border-radius · https://www.facebook.com/reel/1620756073024890

---

### 6. Product-specific visual character

**Rule** Type, colour, space and finish are decided as tokens for the product, not left as framework defaults.

**How to check** Is it the stock shadcn/Tailwind palette and Inter at default sizes with no decisions? = finding (low).

**Source** https://www.designmotionhq.com (homepage skill list)

---

### 7. Contrast

**Rule** Body text ≥ **4.5:1**, large text ≥ **3:1**, focus ring ≥ **3:1** against adjacent colours. Muted greys and placeholder text are the usual failures. Never use colour alone to signal state (≈**8%** of users have colour-vision deficiency) — add icon or text.

**Numbers** 4.5:1, 3:1 (WCAG thresholds, cited on Design Motion's page; standard origin is WCAG). Focus ring demo: **3.2:1** on light and dark.

**How to check** Run a contrast checker on every text/background pair, especially secondary text, placeholders, disabled labels, text on images/gradients. Red/green-only status = finding.

**Source** https://designmotionhq.com/patterns/color-accessibility · https://designmotionhq.com/patterns/form-field-states · https://www.facebook.com/reel/4421962048072389

---

### 8. Focus is a feature

**Rule**
- Never `outline:none` without a replacement: **2px** ring, offset, contrasting on light and dark.
- Use `:focus-visible` → ring for keyboard, no ring on mouse click.
- **Tab order = DOM order = visual order** (CSS reordering makes focus "teleport").
- **Focus trap** inside modals; **Esc** closes and returns focus to the trigger.
- **Skip link** to jump past the header (demo: **40** links before content).
- Focus ring colour ≠ active/selected colour.

**Good vs Bad**
```css
/* Bad */  button:focus { outline: none; }
/* Good */ button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
```

**How to check** Tab through the whole screen: every interactive element shows a ring; order follows layout; modal traps and restores focus; first Tab reveals "Skip to content".

**Source** https://designmotionhq.com/patterns/focus-states · https://designmotionhq.com/patterns/tabs-system · https://www.facebook.com/reel/4421962048072389

---

### 9. Real semantics and keyboard

**Rule** Accordion headers are `<button>` with `aria-expanded`/`aria-controls`; toggles respond to **Space** and expose `aria-checked`; tabs move with **Arrow keys, Home, End**, and **Tab** leaves the tablist; menus and sliders are keyboard-operable.

**Numbers** Touch targets ≥ **44px** (shown in Design Motion's tabs reel; also a platform standard, not from Design Motion originally).

**How to check** Keyboard-only pass + accessibility tree inspection; `div onClick` controls = finding.

**Source** https://designmotionhq.com/patterns/accordion-disclosure · https://designmotionhq.com/patterns/toggle-anatomy · https://designmotionhq.com/patterns/tabs-system · https://designmotionhq.com/patterns/range-sliders · https://www.facebook.com/reel/979499467901827 · https://www.facebook.com/reel/27114469058187838

---

### 10. Dark mode is a system

**Rule**
1. **Surface**: near-black, not black (`#121212`-ish). Pure `#000` everywhere = "a terminal": OLED wins battery, you lose depth.
2. **Elevation = lightness**: higher surfaces are lighter; shadows barely show.
3. **Text**: three tiers of white (off-white primary, then dimmer tiers via opacity) — never pure `#FFFFFF` body text.
4. **Accent**: calm it — desaturate ~**20%**.
5. **Hairlines**: alpha borders (e.g. `rgba(255,255,255,.08)`), not grey hex.
6. **Images**: dim photos (`filter: brightness(.9)` in the demo) or ship a redrawn dark variant.
Swap token sets — never invert colours.

**Schema**
```
page   #0B0D10   ← lowest
list   #131618
hover  #1A1E25   ← highest   (Linear reel demo values)
border 1px rgba(255,255,255,.08)
```

**How to check** Inspect background (#000 = finding), body text (#FFF = finding), accent saturation vs light theme, shadows used as the only elevation cue, full-brightness photos.

**Source** https://designmotionhq.com/patterns/dark-mode · https://designmotionhq.com/patterns/design-tokens · https://www.facebook.com/reel/4527950214187522 · https://www.facebook.com/reel/882296604820252

---

### 11. Depth: borders/surfaces in dense tools, shadows only on what floats

**Rule** Dense tools: **borders, not shadows** — three background values + a **1px** hairline at **8%** alpha, `box-shadow: none`. Elsewhere use layered shadows (contact + mid + ambient), and **only on things that float** (menus, popovers, dragged items, modals) — "when everything floats" nothing does.

**Numbers** Hairline `1px solid rgba(255,255,255,.08)`; contact shadow ≈ `0 1px 3px`; surface values: **3**.

**How to check** Count elements with box-shadow on a static page; shadows on static cards in a dashboard = finding.

**Source** https://designmotionhq.com/patterns/shadow-elevation · https://designmotionhq.com/patterns/depth-layers · https://designmotionhq.com/patterns/reverse-engineered-linear · https://www.facebook.com/reel/882296604820252 · https://www.facebook.com/reel/1562348875576398

---

### 12. Density and alignment read as competence (new, from Linear reel)

**Rule** Pro tools should be dense: small text and compact rows so more fits above the fold. Alignment should be "invisible when right": every column, icon and label on a shared grid line.

**Numbers** (reel demo) **13px** text, **32px** rows.

**How to check** Measure row height and body size in data-heavy views; 48px+ rows with 16px text in a power tool = finding (low). Overlay a grid: misaligned columns/icons = finding.

**Source** https://designmotionhq.com/patterns/reverse-engineered-linear · https://www.facebook.com/reel/882296604820252

---

### 13. Icons: one stroke, one style, one grid

**Rule** One stroke weight across the set, fixed grid, fixed bounding box, optical sizing, one style (all outline or all filled).

**Numbers** Stroke **2px**; grid **24px** (**16px** dense); circular/organic shapes **5–8%** larger than squares.

**How to check** Compare stroke widths and fill styles across icons on one screen; mixed = finding.

**Source** https://designmotionhq.com/patterns/icon-design-rules

---

### 14. Gradients: ambiance, not surface

**Rule** ≤ **60°** of hue travel, monotonic lightness, add grain, use as background ambiance; never put text over the mid-transition. On dashboards: no decorative gradients — one flat accent.

**How to check** Measure hue span of gradients; text over gradient → contrast check at the worst point.

**Source** https://designmotionhq.com/patterns/gradient-design · https://www.facebook.com/reel/1562348875576398

---

### 15. Avatars are a component system (new, from reel)

**Rule**
1. **Fallback chain**: image → initials → generic icon. A failed image degrades, never breaks.
2. **Deterministic colour**: hash(name or id) → hue, so the same person has the same colour everywhere.
3. **Initials**: **2** letters by default, **1** only when tiny.
4. **Stacks**: overlap the group and cap the row with "+N".
5. **Presence lives on the ring** (one integrated signal), not a second stacked badge.
6. **Sizes**: three, then stop — **24** (list), **32** (header), **40** (profile).

**Good vs Bad**
```js
const hue = hash(user.id) % 360; // same person, same colour, every screen
```

**How to check** Break an image URL: does initials fallback appear? Same user with different colours in two places = finding. Count avatar sizes in the product (> 3 = finding).

**Source** https://www.facebook.com/reel/1769259328059594 · https://www.facebook.com/reel/1562882515556734

---

### 16. Stacking order: tame z-index (new, from reel)

**Rule**
1. `z-index` only works on positioned elements (`relative/absolute/fixed/sticky`).
2. A parent's stacking context caps its children — `z-index: 9999` inside a `z-index: 1` parent can't escape.
3. Give reusable components `isolation: isolate` for a clean local stack.
4. Debug visually (browser layers panel) instead of spraying `9000`.
Use a small token scale for layers (e.g. dropdown < sticky < modal < toast).

**Good vs Bad**
```css
/* Bad */  .dropdown { z-index: 99999; }
/* Good */ .card { isolation: isolate; } .dropdown { position:absolute; z-index: var(--z-dropdown); }
```

**How to check** grep for `z-index` values > 100 or not from tokens = finding; dropdown hidden behind a sibling card = finding.

**Source** https://www.facebook.com/reel/1723715535134023

---

### 17. Let CSS state drive the UI with :has() (new, from reel)

**Rule** Use parent-aware selectors instead of JS state plumbing:
- `.plan:has(:checked)` — the card reacts to its radio/checkbox.
- `.field:has(:user-invalid) { border-color: var(--error) }` — the whole field knows it's invalid (only after interaction).
- `.app:has(aside) { grid-template-columns: 280px 1fr }` — layout follows the DOM.
- `.plans:has(> :nth-child(n + 5)) { --density: compact }` — the grid counts its children.
- `body:has(dialog[open]) { overflow: hidden }` — no scroll behind a modal.

**How to check** Look for JS that only toggles classes mirroring checked/invalid/open state; scroll leaking behind open dialogs = finding.

**Source** https://designmotionhq.com/patterns/css-has-selector · https://www.facebook.com/reel/1723838365576036
