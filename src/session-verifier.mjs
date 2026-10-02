import { computeSnapshotDigest } from './sqlite-store.mjs';
import { HashChainJournal } from './journal.mjs';

export function verifySessionPackage(packageData) {
  const reasons = [];
  const warnings = [];
  const observations = Array.isArray(packageData?.observations) ? packageData.observations : null;
  const events = Array.isArray(packageData?.events) ? packageData.events : null;
  if (!packageData || packageData.format !== 'sidechannel-session') reasons.push('format is not sidechannel-session');
  if (!observations) reasons.push('observations must be an array');
  if (!events) reasons.push('events must be an array');

  const ids = new Set();
  let previousSequence = null;
  for (const observation of observations || []) {
    if (!observation || typeof observation.id !== 'string') {
      reasons.push('observation id is missing');
      continue;
    }
    if (ids.has(observation.id)) reasons.push('duplicate observation id: ' + observation.id);
    ids.add(observation.id);
    if (typeof observation.sequence === 'number') {
      if (previousSequence !== null && observation.sequence <= previousSequence) {
        reasons.push('observation sequence is not strictly increasing');
      }
      previousSequence = observation.sequence;
    }
  }

  const snapshotComplete = packageData?.historicalSnapshotComplete === true;
  if (packageData?.formatVersion === '0.2' && snapshotComplete) {
    const expectedDigest = computeSnapshotDigest({
      sceneSnapshot: packageData.sceneSnapshot,
      sourceRegistrySnapshot: packageData.sourceRegistrySnapshot,
      calibrationRegistrySnapshot: packageData.calibrationRegistrySnapshot,
      transformGraphSnapshot: packageData.transformGraphSnapshot,
      runtimeBuildId: packageData.runtimeBuildId,
      schemaSetDigest: packageData.schemaSetDigest
    });
    if (expectedDigest !== packageData.snapshotDigest) reasons.push('snapshot digest mismatch');
  } else {
    warnings.push('historical snapshot is incomplete; export is not revision-self-contained');
  }

  if (packageData?.privacy) {
    for (const flag of ['rawAudioIncluded', 'networkPayloadsIncluded', 'persistentDeviceIdsIncluded']) {
      if (packageData.privacy[flag] === true) reasons.push('prohibited privacy flag is true: ' + flag);
    }
    if (packageData.privacy.classes !== undefined && !Array.isArray(packageData.privacy.classes)) {
      reasons.push('privacy.classes must be an array');
    }
  }
  let journalVerified = false;
  if (Array.isArray(packageData?.journal)) {
    const journal = new HashChainJournal({ sessionId: packageData.sessionId || packageData.journal[0]?.sessionId || 'session_unknown' });
    const journalReport = journal.verify(packageData.journal);
    journalVerified = journalReport.ok;
    if (!journalReport.ok) reasons.push(journalReport.reason);
  } else {
    warnings.push('journal is absent; append-only tail integrity was not checked');
  }
  return {
    ok: reasons.length === 0,
    reasons,
    warnings,
    checks: {
      format: packageData?.format === 'sidechannel-session',
      observationCount: observations?.length || 0,
      eventCount: events?.length || 0,
      uniqueObservationIds: ids.size === (observations?.length || 0),
      historicalSnapshotComplete: snapshotComplete,
      snapshotDigestVerified: packageData?.formatVersion === '0.2' && snapshotComplete && reasons.every((reason) => reason !== 'snapshot digest mismatch'),
      journalEventCount: Array.isArray(packageData?.journal) ? packageData.journal.length : 0,
      journalVerified
    }
  };
}
