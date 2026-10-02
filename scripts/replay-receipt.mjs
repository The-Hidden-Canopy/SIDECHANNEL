import { readFile } from 'node:fs/promises';
import { createReplayReceipt, verifyReplayReceipt } from '../src/verification/receipt.mjs';

const filePath = process.argv[2];
if (!filePath) {
  console.error('usage: node scripts/replay-receipt.mjs path/to/exported-session.json');
  process.exitCode = 2;
} else {
  const packageData = JSON.parse(await readFile(filePath, 'utf8'));
  const session = {
    id: packageData.sessionId || packageData.id || 'imported-session',
    snapshotDigest: packageData.snapshotDigest,
    runtimeBuildId: packageData.runtimeBuildId,
    schemaSetDigest: packageData.schemaSetDigest,
    observations: packageData.observations || [],
    events: packageData.events || [],
    sceneSnapshot: packageData.sceneSnapshot || packageData.scene,
    sourceRegistrySnapshot: packageData.sourceRegistrySnapshot || packageData.sources,
    calibrationRegistrySnapshot: packageData.calibrationRegistrySnapshot || [],
    transformGraphSnapshot: packageData.transformGraphSnapshot || { revision: 0, edges: [] }
  };
  const receipt = createReplayReceipt(session, { sourceCommit: process.env.SIDECHANNEL_SOURCE_COMMIT || 'unknown' });
  console.log(JSON.stringify({ receipt, verification: verifyReplayReceipt(receipt) }, null, 2));
}
