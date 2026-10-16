Backlog: shared components for the redesign, step S1. A new `PartsBar` in the shared UI: one bar of one or more parts, each sized by its value over a total, with a track for what is left, an optional dot legend, and the signal colour when a part goes over. Its stories and tests are in the shared UI; no screen uses it yet.

Home's split card (the "ממה מורכב" bar) is the first screen on PartsBar, and its local bar CSS is gone. The bar's look is unchanged.
