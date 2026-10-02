const mode = process.argv[2] || 'valid';

function emit(frame) {
  process.stdout.write(JSON.stringify(frame) + '\n');
}

emit({ protocolVersion: 'sidechannel.adapter/1', type: 'hello', payload: { providerId: 'fixture.adapter' } });
if (mode === 'invalid') {
  process.stdout.write('{not-json}\n');
  emit({ protocolVersion: 'sidechannel.adapter/99', type: 'observation', payload: {} });
  process.exit(0);
}
if (mode === 'oversized') {
  emit({ protocolVersion: 'sidechannel.adapter/1', type: 'diagnostic', payload: { text: 'x'.repeat(2_000) } });
  process.exit(0);
}
if (mode === 'crash') process.exit(1);
if (mode === 'wait') {
  setInterval(() => {}, 1_000);
} else {
  emit({
    protocolVersion: 'sidechannel.adapter/1',
    type: 'observation',
    payload: { observation: { id: 'fixture_observation', sourceId: 'fixture_source', channel: 'heat', value: 21 } }
  });
}
