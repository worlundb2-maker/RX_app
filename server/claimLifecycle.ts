import type { PioneerClaim } from './types';

export type ClaimLifecycle = PioneerClaim['normalizedClaimLifecycle'];

type LifecycleInput = {
  claimStatus?: string | null;
  currentTransactionStatus?: string | null;
  normalizedClaimLifecycle?: ClaimLifecycle | null;
};

function asText(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function includesAny(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function isKnownLifecycle(value: string): value is ClaimLifecycle {
  return ['active', 'reversed', 'cancelled', 'rejected_on_hold', 'transferred', 'other_inactive'].includes(value);
}

export function normalizeClaimLifecycle(input: Pick<LifecycleInput, 'claimStatus' | 'currentTransactionStatus'>): ClaimLifecycle {
  const claimType = asText(input.claimStatus).toUpperCase();
  const claimTypeText = claimType.toLowerCase();
  const currentStatus = asText(input.currentTransactionStatus).toLowerCase();
  const combined = `${claimTypeText} ${currentStatus}`.trim();

  if (claimType === 'B2' || includesAny(combined, /reversal|reversed|reverse/)) return 'reversed';
  if (includesAny(combined, /transfer|transferred/)) return 'transferred';
  if (includesAny(currentStatus, /cancel/) && !claimType) return 'rejected_on_hold';
  if (includesAny(combined, /reject|on hold|hold/)) return 'rejected_on_hold';
  if (includesAny(combined, /cancel|cancelled/)) return 'cancelled';
  if (claimType === 'B1' || includesAny(combined, /complete|completed|paid|sold|adjudicated/)) return 'active';
  return combined ? 'other_inactive' : 'active';
}

export function classifyClaimLifecycle(input: LifecycleInput): ClaimLifecycle {
  const hasRawLifecycleSignals = asText(input.claimStatus) !== '' || asText(input.currentTransactionStatus) !== '';
  if (hasRawLifecycleSignals) {
    return normalizeClaimLifecycle(input);
  }
  const normalized = String(input.normalizedClaimLifecycle || '').toLowerCase();
  return isKnownLifecycle(normalized) ? normalized : 'active';
}

export function isInactiveClaim(input: LifecycleInput): boolean {
  return classifyClaimLifecycle(input) !== 'active';
}
