<a id="flow-338"></a>
# FLOW-338 · Project band shows a loss in red on violet
- **Type:** BUG · **Status:** done (#290) · **Depends on:** — · **Source:** mobile UI/UX review cycle 6 (2026-10-09, deploy 3f718f2), shots in the project's reviews/ui-ux-cycle-6/
- **What:** On the project page the band's loss figure is drawn with `.ui-loss` (rgb(195,48,43) in light, salmon in dark) on the violet band, about 1.6:1. DESIGN-RULES §3.5 says the hero stays the on-band white including a minus, and the label names the loss. Stop passing `loss` to the band figure (`project-detail-screen.tsx`), or scope `.ui-band .ui-loss { color: var(--color-on-band) }`.
- **Acceptance:** a band-loss story in light and dark; contrast check on the band; a design log entry.
