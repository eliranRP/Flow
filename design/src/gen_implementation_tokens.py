# Generates final/implementation-tokens.css from final/design-tokens.json.
# Run: python3 gen_implementation_tokens.py   (reads the JSON only; never touches other files in final/)
import json, pathlib
D = pathlib.Path(__file__).parent  # repo layout: design/src (on the design box this was ../final)
T = json.loads((D / "design-tokens.json").read_text(encoding="utf-8"))

def colors(mode, indent="  "):
    return "\n".join(f"{indent}--color-{k}: {v};" for k, v in T["color"][mode].items())

# Values not in design-tokens.json but used by the reference CSS (flow.py / ds.py) or defined by the guide.
DERIVED = {
    "light": {"knob": "#FFFFFF", "toast-bad": T["color"]["dark"]["bad"], "badge-bg": T["color"]["light"]["text"], "badge-text": T["color"]["light"]["surface"], "focus": T["color"]["light"]["accent-text"], "focus-on-band": T["color"]["light"]["on-band"], "skeleton": T["color"]["light"]["tint"], "skeleton-shine": "#FAF6FF"},
    "dark":  {"knob": "#FFFFFF", "toast-bad": T["color"]["light"]["bad"], "badge-bg": T["color"]["dark"]["text"], "badge-text": T["color"]["dark"]["surface"], "focus": T["color"]["dark"]["accent-text"], "focus-on-band": T["color"]["dark"]["on-band"], "skeleton": T["color"]["dark"]["tint"], "skeleton-shine": "#33285A"},
}
def derived(mode, indent="  "):  # only fills keys the JSON doesn't already define (tokens.py now carries them)
    return "\n".join(f"{indent}--color-{k}: {v};" for k, v in DERIVED[mode].items() if k not in T["color"][mode]) or f"{indent}/* none: all colours now come from design-tokens.json */"

type_lines = []
for k, v in T["type"].items():
    type_lines.append(f"  --type-{k}-size: {v['size']/16:g}rem; /* {v['size']}px */")
    type_lines.append(f"  --type-{k}-line: {v['lineHeight']};")
    type_lines.append(f"  --type-{k}-weight: {v['weight']};")
space = "\n".join(f"  --space-{k}: {v}px;" for k, v in T["space"].items())
radius = "\n".join(f"  --radius-{k}: {v}px;" for k, v in T["radius"].items())
f = T["font"]

type_classes = "\n".join(
    f".t-{k} {{ font-size: var(--type-{k}-size); line-height: var(--type-{k}-line); font-weight: var(--type-{k}-weight); }}"
    for k in T["type"])

css = f"""/* ==========================================================================
   Flow · implementation tokens (CSS custom properties)
   GENERATED from design-tokens.json by gen_implementation_tokens.py. Do not edit by hand:
   change tokens.py -> design-tokens.json -> re-run the generator.
   Sections marked "guide-defined" are not in design-tokens.json; they are
   defined in implementation-guide.md (motion, layout, derived colours).

   Theme switching:
     - No attribute on <html>      -> follows the OS (prefers-color-scheme)
     - <html data-theme="light">   -> forced light
     - <html data-theme="dark">    -> forced dark
   The band (--color-band) is #7B3FE4 in BOTH modes.
   ========================================================================== */

/* Font (load once in <head>):
   <link rel="preconnect" href="https://fonts.googleapis.com">
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   <link href="{f['google']}" rel="stylesheet"> */

:root {{
  color-scheme: light dark;

  /* ---- font ---- */
  --font-family: "{f['family']}", {f['fallback']};
  --font-numerals: {f['numerals']};

  /* ---- type scale (use ONLY these) ---- */
{chr(10).join(type_lines)}

  /* ---- spacing (4-point scale + named layout values) ---- */
{space}

  /* ---- corner radii ---- */
{radius}

  /* ---- layout (guide-defined, from design-system.md) ---- */
  --touch-min: 44px;
  --control-height: 52px;        /* buttons, text inputs */
  --control-height-sm: 36px;     /* small pill buttons, chips (hit area still 44px) */
  --search-height: 46px;
  --topbar-height: 52px;
  --fab-size: 48px;
  --tabbar-content: 52px;        /* + safe-area-inset-bottom = 86px on notched iPhones */
  --tabbar-height: calc(var(--tabbar-content) + max(env(safe-area-inset-bottom, 0px), 8px));
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --content-max: 480px;          /* phone-only app: wider viewports centre a phone column */

  /* ---- motion (guide-defined) ---- */
  --dur-press: 100ms;
  --dur-fast: 150ms;
  --dur-base: 200ms;
  --dur-sheet-in: 280ms;
  --dur-sheet-out: 220ms;
  --dur-shimmer: 1400ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
  --toast-duration: 4000ms;

  /* ---- colour: light (default) ---- */
{colors('light')}
  /* derived colours (guide-defined) */
{derived('light')}
}}

/* ---- colour: dark, following the OS unless light is forced ---- */
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
{colors('dark', '    ')}
    /* derived colours (guide-defined) */
{derived('dark', '    ')}
  }}
}}

/* ---- colour: dark, forced ---- */
:root[data-theme="dark"] {{
{colors('dark')}
  /* derived colours (guide-defined) */
{derived('dark')}
}}
:root[data-theme="light"] {{ color-scheme: light; }}
:root[data-theme="dark"]  {{ color-scheme: dark; }}

/* ---- motion off for users who ask for it ---- */
@media (prefers-reduced-motion: reduce) {{
  :root {{
    --dur-press: 0ms;
    --dur-fast: 0ms;
    --dur-base: 0ms;
    --dur-sheet-in: 0ms;
    --dur-sheet-out: 0ms;
  }}
}}

/* ==========================================================================
   Optional helpers: type styles and the number span. Components may use the
   variables directly instead; either way, no other sizes are allowed.
   ========================================================================== */
{type_classes}

/* Every figure (amounts, %, dates, counts, phone numbers) goes in .num */
.num {{
  font-variant-numeric: var(--font-numerals);
  direction: ltr;
  unicode-bidi: isolate;
  white-space: nowrap;
}}
"""
(D / "implementation-tokens.css").write_text(css, encoding="utf-8")
print("wrote", D / "implementation-tokens.css")
