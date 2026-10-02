import test from 'node:test';
import assert from 'node:assert/strict';
import { runFaultCampaign, verifyFaultCampaignReceipt } from '../src/verification/faults.mjs';

test('fault campaign produces a passing bounded E2 receipt', async () => {
  const receipt = await runFaultCampaign({ runId: 'fault_test', sourceCommit: 'test' });
  assert.equal(receipt.evidenceLevel, 'E2');
  assert.equal(receipt.passed, true);
  assert.equal(receipt.failedCaseCount, 0);
  assert.equal(receipt.caseCount, 9);
  assert.equal(verifyFaultCampaignReceipt(receipt).ok, true);
});

test('fault campaign receipt verification detects tampering', async () => {
  const receipt = await runFaultCampaign({ runId: 'fault_tamper', sourceCommit: 'test' });
  receipt.cases[0].passed = false;
  assert.equal(verifyFaultCampaignReceipt(receipt).ok, false);
  assert.ok(verifyFaultCampaignReceipt(receipt).reasons.includes('fault campaign receipt digest mismatch'));
});
