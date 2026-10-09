# FLOW-334: Tint retry on the loan page

- PR: #PR
- Kind: screen
- Changed: the loan page's error state (app/src/screens/loan-detail-screen.tsx): "ניסיון חוזר" drops `.ui-btn-retry` and is the plain tint pill, as `ErrorState` has been since #310. Loan setup keeps the filled one until UI lane 4's #345 lands; then the class goes. Story: Screens/Loan page → Error (390, 320).
- Rule: every error and empty-state action is the 44px tint button (DESIGN-RULES §2.8).
- Source: FLOW-334 leftover from the #310 review.
