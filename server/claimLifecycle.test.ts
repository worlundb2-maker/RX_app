import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyClaimLifecycle, isInactiveClaim, normalizeClaimLifecycle } from './claimLifecycle';

test('normalizeClaimLifecycle marks B2 as reversed', () => {
  assert.equal(normalizeClaimLifecycle({ claimStatus: 'B2', currentTransactionStatus: null }), 'reversed');
});

test('normalizeClaimLifecycle maps blank claim type + cancelled to rejected_on_hold', () => {
  assert.equal(normalizeClaimLifecycle({ claimStatus: '', currentTransactionStatus: 'Cancelled' }), 'rejected_on_hold');
});

test('classifyClaimLifecycle uses raw status signals over stored normalized lifecycle', () => {
  assert.equal(classifyClaimLifecycle({ claimStatus: 'B2', currentTransactionStatus: 'Completed', normalizedClaimLifecycle: 'active' }), 'reversed');
});

test('classifyClaimLifecycle falls back to stored normalized lifecycle when raw signals are missing', () => {
  assert.equal(classifyClaimLifecycle({ claimStatus: '', currentTransactionStatus: '', normalizedClaimLifecycle: 'transferred' }), 'transferred');
});

test('isInactiveClaim excludes transferred and allows active claims', () => {
  assert.equal(isInactiveClaim({ claimStatus: '', currentTransactionStatus: 'Transferred' }), true);
  assert.equal(isInactiveClaim({ claimStatus: 'B1', currentTransactionStatus: 'Completed' }), false);
});
