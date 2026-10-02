import { runFaultCampaign, verifyFaultCampaignReceipt } from '../src/verification/faults.mjs';

const receipt = await runFaultCampaign({
  sourceCommit: process.env.SIDECHANNEL_SOURCE_COMMIT || 'unknown'
});
console.log(JSON.stringify({ receipt, verification: verifyFaultCampaignReceipt(receipt) }, null, 2));
if (!receipt.passed) process.exitCode = 1;
