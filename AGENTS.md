# Pharmacy Analytics App Rules

## Do not break these rules
- Keep everything local only.
- Do not require the user to code anything.
- Do not require the user to edit config files, JSON, .env files, or run repair scripts.
- Pioneer claims are the base for analytics.
- MTF files are for SDRA reconciliation only.
- Inventory files overwrite fully.
- Price files overwrite fully.
- Pioneer claims, MTF payments, and MTF adjustments keep a running history with dedupe.
- Every major result must drill down to row-level claim detail.
- Keep the fixed pharmacy mappings and colors exactly correct.
- MV and Monte Vista must map the same way.

## Required work style
- Audit the current source before changing anything.
- Do not rebuild from scratch unless explicitly told.
- Prefer small, safe changes.
- Do not claim completion unless verified.

## Claim status rules
- B2 means reversal.
- Blank claim type + cancelled means rejected/on hold.
- Cancelled, reversed, rejected/on-hold, and transferred claims stay in history but should be excluded from active analytics where appropriate.
