import { createHash } from 'node:crypto';
import { computeSnapshotDigest } from './sqlite-store.mjs';
import { HashChainJournal } from './journal.mjs';
import { validatePoseSample } from './spatial/pose-history.mjs';
import { validateBackground } from './spatial/background.mjs';
import { validateObservation } from './validation.mjs';
import { listSensitiveFields } from './privacy.mjs';

export const SESSION_PACKAGE_LIMITS = Object.freeze({
  maxSerializedBytes: 2_000_000,
  maxObservations: 100_000,
  maxEvents: 100_000,
  maxJournal: 200_000,
  maxSources: 10_000,
  maxPoses: 10_000
});

export function computePackageDigest(packageData) {
  const copy = { ...(packageData || {}) };
  delete copy.packageDigest;
  return createHash('sha256').update(JSON.stringify(copy)).digest('hex');
}

export function verifySessionPackage(packageData) {
  const reasons = [];
  const warnings = [];
  const observations = Array.isArray(packageData?.observations) ? packageData.observations : null;
  const events = Array.isArray(packageData?.events) ? packageData.events : null;
  const poses = packageData?.poses === undefined
    ? []
    : Array.isArray(packageData.poses) ? packageData.poses : null;
  let serializedBytes = 0;
  try {
    serializedBytes = Buffer.byteLength(JSON.stringify(packageData || null), 'utf8');
  } catch {
    reasons.push('package is not JSON-serializable');
  }
  if (!packageData || packageData.format !== 'sidechannel-session') reasons.push('format is not sidechannel-session');
  if (!observations) reasons.push('observations must be an array');
  if (!events) reasons.push('events must be an array');
  if (serializedBytes > SESSION_PACKAGE_LIMITS.maxSerializedBytes) reasons.push('package exceeds serialized byte limit');
  if (observations && observations.length > SESSION_PACKAGE_LIMITS.maxObservations) reasons.push('observation count exceeds package limit');
  if (events && events.length > SESSION_PACKAGE_LIMITS.maxEvents) reasons.push('event count exceeds package limit');
  if (packageData?.poses !== undefined && !poses) reasons.push('poses must be an array');
  if (poses && poses.length > SESSION_PACKAGE_LIMITS.maxPoses) reasons.push('pose count exceeds package limit');
  if (Array.isArray(packageData?.journal) && packageData.journal.length > SESSION_PACKAGE_LIMITS.maxJournal) reasons.push('journal count exceeds package limit');
  if (Array.isArray(packageData?.sourceRegistrySnapshot) && packageData.sourceRegistrySnapshot.length > SESSION_PACKAGE_LIMITS.maxSources) reasons.push('source count exceeds package limit');

  const ids = new Set();
  const poseIds = new Set();
  const baseSourceSnapshot = Array.isArray(packageData?.sourceRegistrySnapshot)
    ? packageData.sourceRegistrySnapshot
    : Array.isArray(packageData?.sources)
      ? packageData.sources
      : Array.isArray(packageData?.sceneSnapshot?.sources) ? packageData.sceneSnapshot.sources : null;
  const journalSources = (Array.isArray(packageData?.journal) ? packageData.journal : [])
    .filter((event) => event?.type === 'SourceRevisionPublished' && event.payload?.source?.id)
    .map((event) => event.payload.source);
  const sourceSnapshot = Array.from(new Map([...(baseSourceSnapshot || []), ...journalSources]
    .filter((source) => source?.id)
    .map((source) => [source.id, source])).values());
  const sourceIds = new Set((sourceSnapshot || []).map((source) => source?.id).filter((id) => typeof id === 'string'));
  const calibrationSnapshot = Array.isArray(packageData?.calibrationRegistrySnapshot)
    ? packageData.calibrationRegistrySnapshot
    : Array.isArray(packageData?.sceneSnapshot?.calibrations) ? packageData.sceneSnapshot.calibrations : null;
  const calibrationIds = new Set((calibrationSnapshot || [])
    .map((calibration) => calibration?.calibrationId)
    .filter((id) => typeof id === 'string'));
  let sourceReferencesVerified = true;
  let calibrationReferencesVerified = true;
  let provenanceReferencesVerified = true;
  let observationSchemaVerified = true;
  let privacyRetentionVerified = true;
  let sceneBackgroundVerified = true;
  if (packageData?.sceneSnapshot?.background !== undefined) {
    const backgroundResult = validateBackground(packageData.sceneSnapshot.background, {
      width: packageData.sceneSnapshot.width,
      height: packageData.sceneSnapshot.height
    });
    if (!backgroundResult.ok) {
      sceneBackgroundVerified = false;
      reasons.push('invalid scene background: ' + backgroundResult.reasons.map((item) => item.id).join(', '));
    }
  }
  let previousSequence = null;
  for (const observation of observations || []) {
    if (!observation || typeof observation.id !== 'string') {
      reasons.push('observation id is missing');
      continue;
    }
    if (ids.has(observation.id)) reasons.push('duplicate observation id: ' + observation.id);
    ids.add(observation.id);
    if (sourceIds.size > 0 && !sourceIds.has(observation.sourceId)) {
      sourceReferencesVerified = false;
      reasons.push('observation references a source not retained in the package: ' + observation.sourceId);
    }
    if (typeof observation.calibrationRef === 'string' && calibrationSnapshot &&
        !calibrationIds.has(observation.calibrationRef)) {
      calibrationReferencesVerified = false;
      reasons.push('observation references a calibration not retained in the package: ' + observation.calibrationRef);
    }
    if (Number.isInteger(observation.transformRevision) && observation.transformRevision < 0) {
      reasons.push('observation transform revision must be non-negative: ' + observation.id);
    }
    const retainedSensitiveFields = listSensitiveFields(observation);
    if (retainedSensitiveFields.length) {
      privacyRetentionVerified = false;
      reasons.push('observation retains prohibited privacy fields: ' + observation.id + ': ' + retainedSensitiveFields.join(', '));
    }
    if (packageData?.formatVersion === '0.2' && observations.length <= SESSION_PACKAGE_LIMITS.maxObservations) {
      const validation = validateObservation(observation, {
        sources: new Map((sourceSnapshot || []).map((source) => [source?.id, source])),
        maxFutureMs: Number.MAX_SAFE_INTEGER
      });
      if (!validation.ok) {
        observationSchemaVerified = false;
        reasons.push('invalid observation ' + observation.id + ': ' + validation.reasons.map((item) => item.id).join(', '));
      }
    }
    if (typeof observation.sequence === 'number') {
      if (previousSequence !== null && observation.sequence <= previousSequence) {
        reasons.push('observation sequence is not strictly increasing');
      }
      previousSequence = observation.sequence;
    }
  }

  for (const observation of observations || []) {
    for (const edge of Array.isArray(observation?.provenance) ? observation.provenance : []) {
      if (edge.relation === 'derived_from' && !ids.has(edge.parentId)) {
        provenanceReferencesVerified = false;
        reasons.push('observation derived input is not retained in the package: ' + edge.parentId);
      }
    }
  }

  for (const pose of poses || []) {
    const result = validatePoseSample(pose);
    if (!result.ok) {
      reasons.push(...result.reasons.map((item) => 'invalid retained pose: ' + item.id));
      continue;
    }
    if (poseIds.has(pose.sampleId)) reasons.push('duplicate pose sample id: ' + pose.sampleId);
    poseIds.add(pose.sampleId);
  }
  let poseReferencesVerified = true;
  for (const observation of observations || []) {
    if (typeof observation?.poseRef !== 'string') continue;
    if (!poseIds.has(observation.poseRef)) {
      poseReferencesVerified = false;
      reasons.push('observation references a pose sample not retained in the package: ' + observation.poseRef);
      continue;
    }
    const pose = (poses || []).find((item) => item.sampleId === observation.poseRef);
    if (pose.sourceId !== observation.sourceId) {
      poseReferencesVerified = false;
      reasons.push('observation pose source does not match observation source: ' + observation.id);
    }
    if (observation.poseFrameId && pose.frameId !== observation.poseFrameId) {
      poseReferencesVerified = false;
      reasons.push('observation pose frame does not match retained pose: ' + observation.id);
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
  let packageDigestVerified = false;
  if (packageData?.packageDigest === undefined) {
    warnings.push('package digest is absent; package-level tamper check was not performed');
  } else if (typeof packageData.packageDigest !== 'string' || packageData.packageDigest.length !== 64) {
    reasons.push('package digest is malformed');
  } else if (computePackageDigest(packageData) !== packageData.packageDigest) {
    reasons.push('package digest mismatch');
  } else {
    packageDigestVerified = true;
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
      poseCount: poses?.length || 0,
      poseReferencesVerified,
      sourceReferencesVerified,
      calibrationReferencesVerified,
      provenanceReferencesVerified,
      observationSchemaVerified,
      privacyRetentionVerified,
      sceneBackgroundVerified,
      uniqueObservationIds: ids.size === (observations?.length || 0),
      historicalSnapshotComplete: snapshotComplete,
      snapshotDigestVerified: packageData?.formatVersion === '0.2' && snapshotComplete && reasons.every((reason) => reason !== 'snapshot digest mismatch'),
      packageDigestVerified,
      journalEventCount: Array.isArray(packageData?.journal) ? packageData.journal.length : 0,
      journalVerified
    }
  };
}
