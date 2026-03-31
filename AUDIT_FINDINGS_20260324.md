# Audit findings and targeted corrections

## Governing alignment
- Local-storage only preserved.
- Pioneer claims remain the baseline for analytics and reconciliation.
- Manual clear flows preserved.
- Fixed pharmacy identities and color mapping preserved.
- Drilldown behavior preserved.

## What was already correct
- Core build is local and file-backed.
- Claims Analysis, Third Party, 340B, NDC, Inventory, and Staffing are still generated from the central app state pipeline.
- Pharmacy identity mapping already enforces Konawa, Monte Vista, Arlington, and Seminole with fixed colors and NPI/NCPDP mapping.
- Manual clear routes already existed and were preserved.

## Issue 1: Day-supply flagging was still too noisy
Current behavior before patch:
- Claims were flagged whenever quantity/day-supply was below 0.5 or above 4.0.
- The existing exception only suppressed exact one-stock-size cycles when the days supply was exactly 7, 14, or 28.
- That still generated false positives on variable-dose package fills, especially pen/injectable items dispensed as one full package.

Root cause:
- The rule treated package-dispensed variable-dose products like fixed-dose oral claims.

Correction applied:
- Kept the 7/14/28 one-stock-size exception.
- Added suppression for exact-stock-size variable-dose package claims using pharmacy + NDC inventory reference context.
- Tightened the residual quantity/day-supply threshold from `<0.5 or >4.0` to `<0.35 or >4.5`.
- Tightened recurring day-supply group flagging from 25% of claims to 40% of claims.

## Issue 2: Staffing was calculated from RX/day but still surfaced with week-based naming
Current behavior before patch:
- Capacity math already used weighted operating days with Monday-Thursday = 1.0 and Friday = 0.5.
- Role pressure calculations were based on average RX per weighted day.
- UI still surfaced `weeklyNormalizedRx`, `overallWeeklyNormalizedRx`, `4.5-day RX`, and summary copy framed around weekly normalization.

Root cause:
- Calculation and presentation were out of sync.

Correction applied:
- Removed week-based staffing output fields from the active UI path.
- Standardized summary and staffing table display to RX/day.
- Preserved weighted operating days as supporting context.
- Kept pressure logic aligned to RX/day demand.

## Issue 3: Upload workflow had unnecessary friction and no stable SFTP-compatible intake
Current behavior before patch:
- Browser uploads remained manual and queued, but intake stayed browser-bound.
- No SFTP-compatible intake path existed.
- The local JSON store was written pretty-printed, increasing disk I/O on larger uploads.

Root cause:
- Upload workflow depended on manual browser transfer and rewrote a larger-than-needed local DB file.

Correction applied:
- Added an inbox scan endpoint using a stable local drop-folder workflow compatible with SFTP delivery or manual file copy.
- Added filename-based assignment rules so file type and pharmacy validation still occur before ingest.
- Preserved manual upload as the primary path.
- Reduced local DB write size by storing compact JSON.

## Files changed
- `server/analysis.ts`
- `server/staffing.ts`
- `server/data.ts`
- `server/routes.ts`
- `client/src/App.tsx`

## Verification completed in this environment
- TypeScript compile check passed.
- Source behavior was executed against provided Seminole Pioneer, Example MTF, and Seminole on-hands files.
- Day-supply false positives for the sample variable-dose pen claims were removed.
- Staffing summary now reports RX/day and still uses weighted operating days.
- Inbox scan endpoint imported a correctly named MTF file from the local inbox folder.
