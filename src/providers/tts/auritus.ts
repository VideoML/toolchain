import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { TTSProvider, TTSRequest, TTSSegment } from './types.js';

const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const digest = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]) => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const extensions = (v: unknown) => record(v) && Object.entries(v).every(([k, x]) => /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(k) && record(x));
const normalizedVoice = (value: string) => {
  const [backend, id = ''] = value.trim().split(':', 2);
  return `${backend.trim().toLowerCase()}:${id.trim() || 'default'}`;
};
const recoverable = /^(INVALID_REQUEST|BACKEND_UNAVAILABLE|MODEL_NOT_INSTALLED|UNSUPPORTED_OPTION|SYNTHESIS_FAILED):/;
const capabilitiesKeys = ['installed', 'ready', 'backend', 'modelId', 'modelRevision', 'auritusVersion', 'voice', 'voices', 'options', 'cacheDisabledReason', 'extensions'];
const resultKeys = ['audioPath', 'metadataPath', 'audioSha256', 'pcmSha256', 'sampleRate', 'sampleCount', 'durationSec', 'segments', 'provenance', 'extensions'];
const provenanceKeys = ['backend', 'modelId', 'modelRevision', 'auritusVersion', 'voice', 'speed', 'seed', 'referenceAudioSha256', 'referenceTranscriptSha256', 'cacheDisabledReason', 'extensions', 'requestKey', 'contentHash'];

type Pending = { id: string; resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

/** Owns one process and serializes requests until clean EOF or fatal failure. */
export class AuritusProvider implements TTSProvider {
  readonly name = 'auritus';
  readonly defaultVoice = 'kokoro:af_heart';
  private child?: ChildProcessWithoutNullStreams;
  private close?: Promise<{code: number | null; signal: NodeJS.Signals | null}>;
  private failed?: Error;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 0;
  private pending?: Pending;

  constructor(private readonly python = 'python3', private readonly voicesDir?: string, private readonly timeoutMs = 300_000) {}

  private fail(error: Error) {
    this.failed ??= error;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(this.failed);
      this.pending = undefined;
    }
  }

  private kill() {
    if (!this.child?.pid) return;
    try {
      if (process.platform === 'win32') this.child.kill('SIGKILL');
      else process.kill(-this.child.pid, 'SIGKILL');
    } catch { /* Process may have already exited. */ }
  }

  private fatal(error: Error): never {
    this.fail(error);
    this.kill();
    throw error;
  }

  private start() {
    if (this.disposed) throw new Error('Auritus session is disposed');
    if (this.failed) throw this.failed;
    if (this.child) return;
    const child = spawn(this.python, ['-m', 'auritus.speech_bridge'], {
      stdio: 'pipe', detached: process.platform !== 'win32',
    });
    this.child = child;
    this.close = new Promise(done => child.once('close', (code, signal) => done({code, signal})));
    child.stderr.on('data', data => process.stderr.write(data));
    child.stdin.on('error', error => this.fail(error));
    child.on('error', error => this.fail(new Error(`Auritus bridge unavailable: ${error.message}`)));
    child.on('exit', (code, signal) => {
      if (!this.disposed || code !== 0) this.fail(new Error(`Auritus bridge exited (${code ?? signal})`));
    });
    createInterface({input: child.stdout}).on('line', line => {
      try {
        const message = JSON.parse(line);
        const pending = this.pending;
        const keys = message?.ok === true ? ['protocol', 'id', 'ok', 'result'] : ['protocol', 'id', 'ok', 'error'];
        if (!pending || !exact(message, keys) || message.protocol !== 1 || message.id !== pending.id || typeof message.ok !== 'boolean') {
          throw new Error('Auritus protocol/id mismatch');
        }
        if (!message.ok) {
          if (!exact(message.error, ['code', 'message']) || !['INVALID_REQUEST', 'BACKEND_UNAVAILABLE', 'MODEL_NOT_INSTALLED', 'UNSUPPORTED_OPTION', 'SYNTHESIS_FAILED'].includes(message.error.code) || typeof message.error.message !== 'string' || !message.error.message) {
            throw new Error('Malformed Auritus error');
          }
          clearTimeout(pending.timer);
          this.pending = undefined;
          pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
        } else {
          if (!record(message.result)) throw new Error('Malformed Auritus result');
          clearTimeout(pending.timer);
          this.pending = undefined;
          pending.resolve(message.result);
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        this.kill();
      }
    });
  }

  private request(op: string, fields: Record<string, unknown>) {
    const run = async () => {
      this.start();
      const id = String(++this.nextId);
      return await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.fail(new Error('Auritus bridge timed out'));
          this.kill();
        }, this.timeoutMs);
        this.pending = {id, resolve, reject, timer};
        const request = {protocol: 1, id, op, ...fields, ...(this.voicesDir ? {voicesDir: this.voicesDir} : {})};
        this.child!.stdin.write(JSON.stringify(request) + '\n', error => { if (error) this.fail(error); });
      });
    };
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }

  async capabilities(voice = this.defaultVoice) {
    const c = await this.request('capabilities', {voice});
    const options = ['speed', 'seed', 'referenceAudio', 'phonemes'];
    const valid = exact(c, capabilitiesKeys) && extensions(c.extensions) && exact(c.options, options)
      && typeof c.installed === 'boolean' && typeof c.ready === 'boolean'
      && typeof c.backend === 'string' && !!c.backend
      && (c.modelId === null || typeof c.modelId === 'string' && !!c.modelId)
      && (c.modelRevision === null || typeof c.modelRevision === 'string' && !!c.modelRevision)
      && typeof c.auritusVersion === 'string' && !!c.auritusVersion && c.voice === normalizedVoice(voice)
      && Array.isArray(c.voices) && c.voices.every((v: unknown) => typeof v === 'string' && !!v)
      && options.every(k => typeof c.options[k] === 'boolean')
      && (c.cacheDisabledReason === null || typeof c.cacheDisabledReason === 'string' && !!c.cacheDisabledReason)
      && (c.modelId !== null && c.modelRevision !== null || typeof c.cacheDisabledReason === 'string' && !!c.cacheDisabledReason);
    if (!valid) this.fatal(new Error('Malformed Auritus capabilities'));
    return c;
  }

  async synthesize(req: TTSRequest, outPath: string): Promise<TTSSegment> {
    const voice = req.voice ?? this.defaultVoice;
    const speed = req.extra?.speed ?? 1;
    const seed = req.extra?.seed ?? 0;
    const envelope = await mkdtemp(join(dirname(outPath), '.auritus-request-'));
    const dir = join(envelope, 'output');
    let metadataPublished = false;
    let primaryError: unknown;
    try {
      await mkdir(dir);
      if (req.format !== undefined && req.format.toLowerCase() !== 'wav') throw new Error(`Auritus supports WAV output only, not ${req.format}`);
      const caps = await this.capabilities(voice);
      if (req.model != null && req.model !== caps.modelId) throw new Error(`Requested Auritus model ${req.model} does not match installed model ${caps.modelId ?? '(unavailable)'}`);
      const result = await this.request('synthesize', {text: req.text, voice, speed, seed, outputDir: resolve(dir)});
      if (!exact(result, resultKeys) || !extensions(result.extensions) || result.audioPath !== 'speech.wav' || result.metadataPath !== 'speech.json'
        || !digest(result.audioSha256) || !digest(result.pcmSha256) || !Number.isInteger(result.sampleRate) || result.sampleRate <= 0
        || !Number.isInteger(result.sampleCount) || result.sampleCount < 0 || !Number.isFinite(result.durationSec)
        || Math.abs(result.durationSec - result.sampleCount / result.sampleRate) > 1e-9 || !Array.isArray(result.segments)) {
        throw new Error('Malformed Auritus synthesis result');
      }
      if (result.extensions['auritus.simulation']?.simulated === true) {
        throw new Error('Simulated Auritus backend cannot be used for production generation; select dry-run explicitly');
      }
      const p = result.provenance;
      if (!exact(p, provenanceKeys) || !extensions(p.extensions) || !digest(p.requestKey)
        || p.backend !== caps.backend || p.modelId !== caps.modelId || p.modelRevision !== caps.modelRevision
        || p.auritusVersion !== caps.auritusVersion || p.voice !== caps.voice || p.speed !== speed || p.seed !== seed
        || (p.modelRevision === null && !(typeof p.cacheDisabledReason === 'string' && p.cacheDisabledReason))
        || !(p.cacheDisabledReason === null || typeof p.cacheDisabledReason === 'string' && !!p.cacheDisabledReason)
        || !(p.contentHash === null || digest(p.contentHash))
        || ![p.referenceAudioSha256, p.referenceTranscriptSha256].every(v => v === null || digest(v))) {
        throw new Error('Malformed or mismatched Auritus provenance');
      }
      let previousEnd = 0;
      for (const segment of result.segments) {
        if (!exact(segment, ['text', 'startSec', 'endSec']) || typeof segment.text !== 'string' || !segment.text
          || !Number.isFinite(segment.startSec) || !Number.isFinite(segment.endSec)
          || segment.startSec < previousEnd || segment.endSec < segment.startSec || segment.endSec > result.durationSec) {
          throw new Error('Malformed Auritus segment timing');
        }
        previousEnd = segment.endSec;
      }
      for (const name of ['speech.wav', 'speech.json']) {
        const st = await lstat(join(dir, name));
        if (!st.isFile() || st.isSymbolicLink()) throw new Error('Invalid Auritus output path');
      }
      const wav = await readFile(join(dir, 'speech.wav'));
      const metadata = JSON.parse(await readFile(join(dir, 'speech.json'), 'utf8'));
      if (JSON.stringify(metadata) !== JSON.stringify(result)) throw new Error('Auritus metadata mismatch');
      if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid Auritus WAV');
      let off = 12;
      let format: Buffer | undefined;
      let pcm: Buffer | undefined;
      while (off + 8 <= wav.length) {
        const size = wav.readUInt32LE(off + 4);
        if (off + 8 + size > wav.length) throw new Error('Invalid WAV chunk');
        const id = wav.toString('ascii', off, off + 4);
        if (id === 'fmt ') format = wav.subarray(off + 8, off + 8 + size);
        if (id === 'data') pcm = wav.subarray(off + 8, off + 8 + size);
        off += 8 + size + size % 2;
      }
      if (!format || format.length < 16 || format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1
        || format.readUInt16LE(14) !== 16 || format.readUInt32LE(4) !== result.sampleRate || !pcm
        || pcm.length !== result.sampleCount * 2 || hash(wav) !== result.audioSha256 || hash(pcm) !== result.pcmSha256) {
        throw new Error('Auritus WAV metadata or digest mismatch');
      }
      await rename(join(dir, 'speech.json'), outPath + '.json');
      metadataPublished = true;
      await rename(join(dir, 'speech.wav'), outPath);
      metadataPublished = false;
      return {path: outPath, durationSec: result.durationSec};
    } catch (error) {
      primaryError = error;
      if (metadataPublished) {
        try { await rm(outPath + '.json', {force: true}); } catch { /* Preserve the primary error. */ }
      }
      if (!(error instanceof Error && recoverable.test(error.message))) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        this.kill();
      }
      throw error;
    } finally {
      // The bridge stages siblings of output; a killed child must stop writing
      // before removing the entire private envelope.
      try {
        if (this.failed && this.close) await this.close;
        await rm(envelope, {recursive: true, force: true});
      } catch (error) {
        if (!primaryError) throw error;
      }
    }
  }

  cancel() {
    this.fail(new Error('Auritus generation cancelled'));
    this.kill();
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    await this.queue;
    if (!this.child || !this.close) {
      if (this.failed) throw this.failed;
      return;
    }
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.stdin.end();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>(resolve => {
      timer = setTimeout(() => {
        this.fail(new Error('Auritus bridge did not close after EOF'));
        this.kill();
        resolve(null);
      }, 2000);
    });
    try {
      let outcome = await Promise.race([this.close, timeout]);
      if (outcome === null) outcome = await this.close;
      if (outcome.code !== 0 || outcome.signal) this.fail(new Error(`Auritus bridge closed (${outcome.code ?? outcome.signal})`));
      if (this.failed) throw this.failed;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export class GenerationSession {
  private auritus?: AuritusProvider;
  private terminal = false;
  private settings?: {python: string; voicesDir?: string};

  getAuritus(config: Record<string, unknown>) {
    if (this.terminal) throw new Error('Generation session is closed');
    if (config.python !== undefined && (typeof config.python !== 'string' || !config.python.trim())) {
      throw new Error('providers.auritus.python must be a nonempty string');
    }
    if (config.voices_dir !== undefined && (typeof config.voices_dir !== 'string' || !config.voices_dir.trim())) {
      throw new Error('providers.auritus.voices_dir must be a nonempty string');
    }
    if (config.voice !== undefined && (typeof config.voice !== 'string' || !config.voice.trim())) {
      throw new Error('providers.auritus.voice must be a nonempty string');
    }
    if (config.speed !== undefined && (typeof config.speed !== 'number' || !Number.isFinite(config.speed) || config.speed <= 0)) {
      throw new Error('providers.auritus.speed must be a positive finite number');
    }
    if (config.seed !== undefined && (typeof config.seed !== 'number' || !Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff)) {
      throw new Error('providers.auritus.seed must be a uint32');
    }
    const python = (config.python as string | undefined) ?? 'python3';
    const voicesDir = config.voices_dir as string | undefined;
    if (this.settings && (this.settings.python !== python || this.settings.voicesDir !== voicesDir)) {
      throw new Error('Auritus configuration cannot change within a generation session');
    }
    this.settings ??= {python, voicesDir};
    return this.auritus ??= new AuritusProvider(python, voicesDir);
  }

  cancel() {
    this.terminal = true;
    this.auritus?.cancel();
  }

  async dispose() {
    this.terminal = true;
    await this.auritus?.dispose();
  }
}
