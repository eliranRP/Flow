# FLOW-339: the band label names a loss in any currency

- PR: #TBD
- Kind: screen
- Changed: With a profit in one currency and a loss in another, Home's hero label and the project band's label read "רווח והפסד" plus the period; every figure below keeps its own sign. On the project band, losses in every currency read "הפסד" (before, only a single-currency loss did). The project's overhead switch in the ⋯ menu is labelled "רווח אחרי כלליות", as Settings does; off has no hint, and on shows only the share ("החלק בכלליות ₪40,000"), never the switch's state in words.
- Rule: A label over several currencies' figures never says רווח over a loss: it names both ("רווח והפסד") when the signs differ.
- Source: FLOW-339 cycle 6 review items (band label; overhead switch hint).
