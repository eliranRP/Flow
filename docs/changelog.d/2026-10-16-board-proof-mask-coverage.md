board-proof also reports how much of each frame the text mask covers (`darkMaskCoverage` and `lightMaskCoverage` in summary.json, and in the log line), and it no longer masks text whose parent is hidden.
It also waits for a screen's finite animations (a sheet's scrim fade, say) to finish before the shot, so a proof no longer catches a sheet half faded in.
