<a id="flow-825"></a>
# FLOW-825 · One render helper for the app's tests
- **Type:** SMALL CYCLE · **Status:** claimed (temporary lane, owner request, 2026-10-11, claude/compassionate-goldberg-ubfcqg) · **Depends on:** — · **Source:** owner, 2026-10-11.
- [ ] 103 of the app's 239 test files build their own QueryClient and provider wrapper, and jscpd finds 2,700 duplicated test lines. Add one `renderWithProviders` helper and move the most duplicated files onto it (the round 5 UI tests, books states, SUMIT rows, review all); rename the `round5-ui-*` files after the feature they test.
