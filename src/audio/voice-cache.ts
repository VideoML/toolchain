import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWav } from './wav.js';

export type VoiceCacheIdentity = {
  text: string; provider: string; backend: string; modelId: string; modelRevision: string;
  voiceRevision: string; auritusVersion: string; referenceAudioSha256: string | null;
  referenceTranscriptSha256: string | null; voice: string; speed: number; seed: number;
  output: {format: string; sampleRateHz: number; channels: number; bitsPerSample: number; ffmpeg: {executableSha256: string; versionOutputSha256: string}};
};
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite cache identity');
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Unsupported cache identity');
  return encoded;
}
export function voiceCacheKey(identity: VoiceCacheIdentity): string {
  return sha(canonical({schemaVersion: 1, ...identity}));
}
export function identityFromCapabilities(caps: any, request: {text: string; voice: string; speed: number; seed: number; sampleRateHz: number; ffmpeg?: {executableSha256: string; versionOutputSha256: string}}): {identity: VoiceCacheIdentity | null; reason: string | null} {
  if (caps.cacheDisabledReason !== null) return {identity: null, reason: String(caps.cacheDisabledReason)};
  if (!request.ffmpeg) return {identity: null, reason: 'FFmpeg identity unavailable'};
  if (caps.backend !== 'kokoro' || caps.options?.referenceAudio !== false) return {identity: null, reason: 'Provider reference identity unavailable'};
  const voiceRevision = caps.extensions?.['auritus.kokoro']?.voiceRevision;
  if (!caps.modelRevision || !caps.modelId || !voiceRevision) return {identity: null, reason: 'Model or voice revision unavailable'};
  return {identity: {text: request.text, provider: 'auritus', backend: caps.backend, modelId: caps.modelId,
    modelRevision: caps.modelRevision, voiceRevision, auritusVersion: caps.auritusVersion,
    referenceAudioSha256: null, referenceTranscriptSha256: null, voice: caps.voice,
    speed: request.speed, seed: request.seed, output: {format: 'wav', sampleRateHz: request.sampleRateHz, channels: 1, bitsPerSample: 16, ffmpeg: request.ffmpeg}}, reason: null};
}
export function verifyCachedVoice(path: string, metadata: any): boolean {
  try {
    const wav = readFileSync(path); const info = parseWav(wav, path);
    return info.audioFormat === 1 && info.numChannels === 1 && info.bitsPerSample === 16 && info.data.length % 2 === 0
      && sha(wav) === metadata.audioSha256 && sha(info.data) === metadata.pcmSha256
      && info.sampleRate === metadata.sampleRate && info.data.length / 2 === metadata.sampleCount;
  } catch { return false; }
}
export function readVoiceCache(dir: string, key: string, outPath: string): any | null {
  const wav = join(dir, `${key}.wav`), json = join(dir, `${key}.json`);
  try {
    const entry = JSON.parse(readFileSync(json, 'utf8'));
    if (entry.key !== key || entry.metadataSha256 !== sha(canonical(entry.result)) || !verifyCachedVoice(wav, entry.result)) return null;
    copyFileSync(wav, outPath); writeFileSync(outPath + '.json', JSON.stringify(entry.result));
    return entry.result;
  } catch { return null; }
}
export function writeVoiceCache(dir: string, key: string, source: string, result: unknown): void {
  if (!verifyCachedVoice(source, result)) throw new Error('Cannot cache corrupt voice audio');
  mkdirSync(dir, {recursive: true});
  const base = join(dir, `${key}.${process.pid}.${Math.random().toString(16).slice(2)}`);
  try {copyFileSync(source, base + '.wav');writeFileSync(base + '.json', JSON.stringify({key, result, metadataSha256: sha(canonical(result))}));
    renameSync(base + '.wav', join(dir, `${key}.wav`)); renameSync(base + '.json', join(dir, `${key}.json`));
  } finally {for (const ext of ['.wav', '.json']) if (existsSync(base + ext)) rmSync(base + ext);}
}
