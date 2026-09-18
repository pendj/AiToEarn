import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { patchReviewedRetry } from '../scripts/patch-native-retry.mjs';

test('reviewed native patch prevents ambiguous publish retries without altering read-back polling', () => {
  const fixture = `const failure={retryable:true}; const attempts=0;
    if (failure.retryable && attempts + 1 < 3) { resubmitted=true; }
    if (failure.retryable && true) { reconciled=true; }`;
  const hash = createHash('sha256').update(fixture).digest('hex');
  const context = { resubmitted: false, reconciled: false };
  vm.runInNewContext(patchReviewedRetry(fixture, hash), context);
  assert.equal(context.resubmitted, false);
  assert.equal(context.reconciled, true);
  assert.throws(() => patchReviewedRetry(fixture));
  assert.throws(() => patchReviewedRetry(fixture + ' changed', hash));
});
