import { spawn } from 'node:child_process';
import { consumeJsonLines } from './jsonl.mjs';
import { validateAdapterFrame } from './protocol.mjs';

function diagnostic(message, extra = {}) {
  const { message: detail, ...rest } = extra;
  return { type: 'adapter.process.diagnostic', message, ...rest, ...(detail ? { detail } : {}) };
}

export class SubprocessAdapter {
  constructor({ command, args = [], cwd, env, providerId, supervisor, descriptor = {}, maxLineBytes = 64_000, maxOutputBytes = 2_000_000, stopTimeoutMs = 500 } = {}) {
    if (!command) throw new TypeError('command is required');
    this.command = command;
    this.args = args.slice();
    this.cwd = cwd;
    this.env = env;
    this.providerId = providerId;
    this.supervisor = supervisor;
    this.maxLineBytes = maxLineBytes;
    this.maxOutputBytes = maxOutputBytes;
    this.stopTimeoutMs = stopTimeoutMs;
    this.descriptor = { ...descriptor, connected: false };
    this.state = 'STOPPED';
    this.child = null;
    this.task = null;
    this.stopRequested = false;
    this.stopReason = null;
    this.stdoutBytes = 0;
    this.stderrBytes = 0;
    this.frameCount = 0;
    this.diagnostics = [];
  }

  describe() {
    return Promise.resolve({ ...this.descriptor, connected: this.state === 'RUNNING' });
  }

  start({ onFrame = () => {}, onObservation = () => {}, onDiagnostic = () => {} } = {}) {
    if (this.child || this.task) return Promise.reject(new Error('adapter process is already running'));
    if (this.supervisor && this.providerId) this.supervisor.start(this.providerId);
    this.state = 'STARTING';
    this.stopRequested = false;
    this.stopReason = null;
    this.stdoutBytes = 0;
    this.stderrBytes = 0;
    this.frameCount = 0;
    this.diagnostics = [];
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env ? { ...process.env, ...this.env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.child = child;
    this.state = 'RUNNING';
    this.descriptor.connected = true;
    if (this.supervisor && this.providerId) this.supervisor.attachRuntime(this.providerId, this);

    const report = (value) => {
      this.diagnostics.push(value);
      onDiagnostic(value);
    };
    child.stdout.on('data', (chunk) => {
      this.stdoutBytes += chunk.length;
      if (this.stdoutBytes > this.maxOutputBytes && !this.stopRequested) {
        report(diagnostic('adapter stdout exceeded bounded output limit', { maxOutputBytes: this.maxOutputBytes }));
        this.stopRequested = true;
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk) => {
      this.stderrBytes += chunk.length;
      if (this.stderrBytes <= 16_000) report(diagnostic('adapter stderr', { text: chunk.toString('utf8').slice(0, 1_000) }));
    });

    const linesTask = consumeJsonLines(child.stdout, (raw) => {
      const result = validateAdapterFrame(raw, { maxBytes: this.maxLineBytes });
      if (!result.ok) {
        report(diagnostic('adapter frame rejected', { reasons: result.reasons }));
        return;
      }
      this.frameCount += 1;
      onFrame(result.frame);
      if (result.frame.type === 'observation' && result.frame.payload?.observation) {
        onObservation(result.frame.payload.observation, result.frame);
      }
    }, {
      maxLineBytes: this.maxLineBytes,
      onError: (error) => report(diagnostic('adapter JSONL parse error', error))
    });
    const exitTask = new Promise((resolve) => {
      child.once('error', (error) => {
        this.state = 'FAILED';
        this.descriptor.connected = false;
        report(diagnostic('adapter process error', { error: error.message }));
        if (this.supervisor && this.providerId) this.supervisor.recordFailure(this.providerId, error.message);
        resolve({ code: null, signal: null, error: error.message });
      });
      child.once('exit', (code, signal) => {
        this.descriptor.connected = false;
        if (code === 0 || this.stopRequested) {
          this.state = 'STOPPED';
          if (this.supervisor && this.providerId) {
            if (this.stopReason === 'permission_revoked') {
              this.supervisor.recordCancellation(this.providerId, this.stopReason);
            } else {
              this.supervisor.stop(this.providerId);
            }
          }
        } else {
          this.state = 'FAILED';
          if (this.supervisor && this.providerId) {
            const adapter = this.supervisor.recordFailure(this.providerId, 'process exited with code ' + code);
            if (adapter.state !== 'QUARANTINED') this.supervisor.stop(this.providerId);
          }
        }
        resolve({ code, signal });
      });
    });
    this.task = Promise.all([linesTask, exitTask]).then(([lines, exit]) => ({
      ok: exit.code === 0 || this.stopRequested,
      state: this.state,
      exit,
      frames: this.frameCount,
      stdoutBytes: this.stdoutBytes,
      stderrBytes: this.stderrBytes,
      diagnostics: [...this.diagnostics],
      parseErrors: lines.errors
    })).finally(() => {
      if (this.supervisor && this.providerId) this.supervisor.detachRuntime(this.providerId, this);
      this.child = null;
      this.task = null;
      this.descriptor.connected = false;
    });
    return this.task;
  }

  async stop(reason = 'operator_stop') {
    if (!this.child || !this.task) return { ok: true, state: this.state };
    this.stopRequested = true;
    this.stopReason = reason;
    this.state = 'STOPPING';
    this.child.kill('SIGTERM');
    const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), this.stopTimeoutMs));
    const result = await Promise.race([this.task, timeout]);
    if (result === 'timeout' && this.child) this.child.kill('SIGKILL');
    return result === 'timeout' ? this.task : result;
  }

  health() {
    return Promise.resolve({
      state: this.state,
      connected: this.state === 'RUNNING',
      frameCount: this.frameCount,
      stdoutBytes: this.stdoutBytes,
      stderrBytes: this.stderrBytes,
      diagnostics: [...this.diagnostics]
    });
  }
}
