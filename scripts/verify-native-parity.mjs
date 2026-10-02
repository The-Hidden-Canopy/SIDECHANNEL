import { spawn } from 'node:child_process';
import { createSimulator } from '../src/simulator.mjs';

const executable = process.argv[2];
const ticks = Number(process.argv[3] || 2);

if (!executable || !Number.isInteger(ticks) || ticks < 1 || ticks > 100) {
  console.error('usage: node scripts/verify-native-parity.mjs path/to/sidechannel-native[.exe] [ticks]');
  process.exitCode = 2;
} else {
  const expected = [];
  let clockTick = 0;
  const simulator = createSimulator({
    clock: () => clockTick * 250,
    intervalMs: 60_000,
    emit: (observation) => expected.push(observation)
  });
  for (clockTick = 0; clockTick < ticks; clockTick += 1) simulator.step();

  const output = await new Promise((resolve, reject) => {
    const child = spawn(executable, ['--ticks', String(ticks), '--csv'], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || 'native parity command failed')));
  });

  const rows = output.trim().split(/\r?\n/).slice(1).map((line) => {
    const [id, sourceId, channel, timestampMs, value, qualityScore, evidenceState] = line.split(',');
    return { id, sourceId, channel, timestampMs: Number(timestampMs), value: Number(value), qualityScore: Number(qualityScore), evidenceState };
  });
  const reasons = [];
  if (rows.length !== expected.length) reasons.push(`row count ${rows.length} != ${expected.length}`);
  for (let index = 0; index < Math.min(rows.length, expected.length); index += 1) {
    const actual = rows[index];
    const wanted = expected[index];
    for (const field of ['id', 'sourceId', 'channel']) {
      if (actual[field] !== wanted[field]) reasons.push(`${field} mismatch at row ${index}`);
    }
    if (actual.timestampMs !== wanted.timestampMs) reasons.push(`timestamp mismatch at row ${index}`);
    if (Math.abs(actual.value - wanted.value) > 0.0001) reasons.push(`value mismatch at row ${index}`);
    if (Math.abs(actual.qualityScore - wanted.quality.score) > 0.0001) reasons.push(`quality mismatch at row ${index}`);
    if (actual.evidenceState !== 'simulated') reasons.push(`evidence state mismatch at row ${index}`);
  }
  if (reasons.length) {
    console.error(JSON.stringify({ ok: false, reasons }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, ticks, rows: rows.length, compared: ['id', 'sourceId', 'channel', 'timestampMs', 'value', 'qualityScore', 'evidenceState'] }, null, 2));
  }
}
