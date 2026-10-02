import { createHash } from 'node:crypto';

export const OBSERVATION_SCHEMA = 'sidechannel.observation/2';
export const EVENT_SCHEMA = 'sidechannel.event/1';
export const SESSION_SCHEMA = 'sidechannel.session/0.2';
export const PROVIDER_MANIFEST_SCHEMA = 'sidechannel.adapter/1';

export const SCHEMA_SET = Object.freeze({
  observation: OBSERVATION_SCHEMA,
  event: EVENT_SCHEMA,
  session: SESSION_SCHEMA,
  providerManifest: PROVIDER_MANIFEST_SCHEMA
});

export const SCHEMA_SET_DIGEST = createHash('sha256')
  .update(JSON.stringify(SCHEMA_SET))
  .digest('hex');
