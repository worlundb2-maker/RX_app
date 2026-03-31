# Release Gate Verification (Issue 16)

Run these checks locally before shipping any update:

1. `npm run check`
2. `npm run test:regression`
3. `npm run build`

Or run the combined gate:

- `npm run release:gate`

## What the regression suite protects

- **Claim lifecycle safety:** B2 reversals and blank claim type + cancelled claims are excluded from active analytics.
- **Overwrite safety:** inventory uploads overwrite the selected pharmacy snapshot; RX/340B price uploads overwrite their respective group snapshots.
- **History + dedupe safety:** Pioneer claims and MTF ingests preserve running history while deduping on stable business keys.
- **Fixed pharmacy mapping safety:** MV and Monte Vista resolve to the same MONTE_VISTA mapping and color.

## Manual verification checklist (post-gate)

1. Upload one Pioneer file with a mix of active + cancelled/reversed claims and confirm inactive claims are counted in excluded totals, not active KPIs.
2. Upload inventory twice for the same pharmacy and confirm the second file fully replaces that pharmacy inventory rows.
3. Upload RX price file twice and confirm only the latest RX rows remain (340B should remain untouched).
4. Upload an MTF payment file with one matching ICN twice (different payment amount), then confirm there is one updated row, not duplicates.
5. Confirm Monte Vista analytics appear under the fixed MONTE_VISTA identity when file naming uses either `MV` or `Monte Vista` naming conventions.

These gates are intentionally local-only and preserve current upload/reporting workflows.
