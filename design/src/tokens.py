# Flow design tokens — V1 Violet with coloured top band (approved 26 Sep 2026)
# control-off / control-border = switch track off, checkbox border, input border: >= 3:1 (WCAG 1.4.11 non-text).
# knob-on = knob when the switch is on (dark: dark knob on the light violet track, 7.3:1). bad-tint = soft fill behind destructive confirm buttons.
# knob, toast-bad, badge-*, focus* = component colours defined in implementation-guide.md, now tokens.
# logo = wordmark colour off the band (brand violet / lilac, decision 0031); on the band the wordmark stays on-band (white).
# skeleton* = loading placeholders (decorative, exempt from AA). -band variants sit on the violet band (= white 20% / 32% over #7B3FE4).
def _lum(h):
    h = h.lstrip('#'); r, g, b = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
def contrast(a, b):
    la, lb = sorted([_lum(a), _lum(b)], reverse=True); return (la + 0.05) / (lb + 0.05)

COLOR = {
 "light": {
  "bg": "#FFFFFF", "surface": "#FFFFFF", "raised": "#FFFFFF", "tint": "#F3ECFE", "tint-strong": "#E7DAFD", "line": "#EEE8FA", "control-off": "#8F86A3", "control-border": "#8F86A3",
  "text": "#1D1728", "text-secondary": "#564E66", "text-muted": "#6A627A",
  "accent": "#7B3FE4", "accent-text": "#6C2ED6", "on-accent": "#FFFFFF", "logo": "#7B3FE4",
  "band": "#7B3FE4", "on-band": "#FFFFFF", "on-band-secondary": "#F0E8FF", "band-chip": "#FFFFFF", "band-pill": "#FFFFFF",
  "good": "#15733F", "bad": "#C3302B", "warning": "#8A5700",
  "scrim": "rgba(29,23,40,.45)", "toast-bg": "#1D1728", "toast-text": "#FFFFFF", "seg-on": "#FFFFFF",
  "accent-pressed": "#6631C9", "tint-pressed": "#E7DAFD", "disabled-bg": "#F1EEF6", "disabled-text": "#8F889C", "error": "#C3302B",
  "skeleton": "#F3ECFE", "skeleton-shine": "#FAF6FF", "skeleton-band": "#9565E9", "skeleton-band-shine": "#A57CED",
  "knob": "#FFFFFF", "knob-on": "#FFFFFF", "bad-tint": "#FCEDEC", "toast-bad": "#FF8A80", "badge-bg": "#1D1728", "badge-text": "#FFFFFF", "focus": "#6C2ED6", "focus-on-band": "#FFFFFF",
 },
 "dark": {
  "bg": "#15111E", "surface": "#1E1929", "raised": "#251F33", "tint": "#2A2045", "tint-strong": "#382A5E", "line": "#2E2740", "control-off": "#736A8C", "control-border": "#736A8C",
  "text": "#F1EDF8", "text-secondary": "#B1A8C4", "text-muted": "#978EAB",
  "accent": "#B894FF", "accent-text": "#C3A5FF", "on-accent": "#1E0B45", "logo": "#B894FF",
  "band": "#7B3FE4", "on-band": "#FFFFFF", "on-band-secondary": "#F0E8FF", "band-chip": "#1E1929", "band-pill": "#1E1929",
  "good": "#62CB8D", "bad": "#FF8A80", "warning": "#EDB866",
  "scrim": "rgba(5,3,10,.62)", "toast-bg": "#F1EDF8", "toast-text": "#15111E", "seg-on": "#3B2F5E",
  "accent-pressed": "#A47FF0", "tint-pressed": "#382A5E", "disabled-bg": "#2A2438", "disabled-text": "#7A7290", "error": "#FF8A80",
  "skeleton": "#2A2045", "skeleton-shine": "#33285A", "skeleton-band": "#9565E9", "skeleton-band-shine": "#A57CED",
  "knob": "#FFFFFF", "knob-on": "#1E0B45", "bad-tint": "#3A1E24", "toast-bad": "#C3302B", "badge-bg": "#F1EDF8", "badge-text": "#1E1929", "focus": "#C3A5FF", "focus-on-band": "#FFFFFF",
 },
}
TYPE = {  # size px, line-height, weight
 "hero": (52, 1.15, 600), "display": (36, 1.2, 600), "title-1": (28, 1.3, 600), "title-2": (22, 1.35, 600),
 "title-3": (17, 1.45, 600), "body": (16, 1.5, 500), "label": (15, 1.5, 500), "hint": (13, 1.45, 400), "micro": (11, 1.3, 500),
 "wordmark": (22, 1.2, 700),
}
SPACE = {"1": 4, "2": 8, "3": 12, "4": 16, "5": 20, "6": 24, "8": 32, "10": 40, "side": 24, "card-inset": 16, "section": 36}
RADIUS = {"chip": 9999, "input": 12, "button": 14, "card": 16, "sheet": 24, "band": 28, "fab": 9999}
FONT = {"family": "Rubik", "fallback": "system-ui, sans-serif", "google": "https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&display=swap", "numerals": "tabular-nums lining-nums"}

CHECKS = [("text","bg"),("text","surface"),("text-secondary","bg"),("text-secondary","surface"),("text-muted","bg"),("text-muted","surface"),("text-muted","tint"),("text","tint"),
          ("accent-text","bg"),("accent-text","surface"),("accent-text","tint"),("on-accent","accent"),("on-band","band"),("on-band-secondary","band"),
          ("bad","band-chip"),("good","band-chip"),("bad","surface"),("good","surface"),("warning","surface"),("text","band-pill"),("toast-text","toast-bg"),("text","seg-on"),("text","raised"),("text-muted","raised"),("on-accent","accent-pressed"),("text","tint-pressed"),("accent-text","tint-pressed"),("error","surface"),
          ("control-off","bg"),("control-off","surface"),("control-border","bg"),("control-border","surface"),("knob","control-off"),("knob-on","accent"),("bad","bad-tint"),("toast-bad","toast-bg"),("badge-text","badge-bg"),("focus","bg"),("focus-on-band","band"),("logo","bg"),("logo","surface")]
NONTEXT = {"control-off", "control-border", "knob", "knob-on", "focus", "focus-on-band"}  # WCAG 1.4.11: 3:1, not 4.5:1
def need(a, b): return 3.0 if a in NONTEXT or b in NONTEXT else 4.5
if __name__ == "__main__":
    for m, c in COLOR.items():
        for a, b in CHECKS:
            r = contrast(c[a], c[b]); print(f"{m:5} {a:>18} on {b:<11} {r:5.2f}" + (f"  (needs {need(a,b):g})" if need(a,b) < 4.5 else "") + ("" if r >= need(a, b) else "  FAIL"))
