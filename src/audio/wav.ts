import { readFileSync, writeFileSync } from "fs";
import { ensureDir } from "../util.js";
import { dirname } from "path";

export function writeSilenceWav(path: string, durationSec: number, sampleRateHz = 44100): void {
  if (!Number.isFinite(durationSec) || durationSec < 0 || !Number.isInteger(sampleRateHz) || sampleRateHz <= 0) throw new Error("Invalid silence duration or sample rate");
  const frames = Math.floor(durationSec * sampleRateHz + 0.5);
  const numSamples = frames;
  const dataSize = numSamples * 2; // 16-bit mono

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(sampleRateHz * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  const silence = Buffer.alloc(dataSize);
  ensureDir(dirname(path));
  writeFileSync(path, Buffer.concat([header, silence]));
}

export type WavInfo = {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  data: Buffer;
};

export function parseWav(buffer: Buffer, path = "<buffer>"): WavInfo {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Invalid WAV header: ${path}`);
  }
  if (buffer.readUInt32LE(4) + 8 !== buffer.length) throw new Error(`Invalid WAV RIFF length: ${path}`);
  let fmt: { audioFormat: number; numChannels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let data: Buffer | null = null;
  let offset = 12;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw new Error(`Truncated WAV chunk header: ${path}`);
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkStart + chunkSize + (chunkSize % 2) > buffer.length) throw new Error(`Truncated WAV chunk: ${path}`);
    if (chunkId === "fmt ") {
      if (fmt || chunkSize < 16) throw new Error(`Invalid WAV format: ${path}`);
      const channels = buffer.readUInt16LE(chunkStart + 2), rate = buffer.readUInt32LE(chunkStart + 4), bits = buffer.readUInt16LE(chunkStart + 14);
      const align = buffer.readUInt16LE(chunkStart + 12), byteRate = buffer.readUInt32LE(chunkStart + 8);
      if (buffer.readUInt16LE(chunkStart) === 1 && (!channels || !rate || !bits || bits % 8 || align !== channels * bits / 8 || byteRate !== rate * align)) throw new Error(`Invalid WAV PCM format: ${path}`);
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        numChannels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === "data") {
      if (!fmt || data) throw new Error(`Duplicate or unordered WAV data: ${path}`);
      data = buffer.subarray(chunkStart, chunkStart + chunkSize);
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  if (!fmt || !data) {
    throw new Error(`Missing WAV chunks: ${path}`);
  }
  if (fmt.audioFormat === 1 && data.length % (fmt.numChannels * fmt.bitsPerSample / 8)) throw new Error(`Invalid WAV PCM data length: ${path}`);
  return { ...fmt, data };
}

export function concatWavFiles(outPath: string, segmentPaths: string[]): void {
  const infos = segmentPaths.map((p) => parseWav(readFileSync(p), p));
  const [first] = infos;
  for (const info of infos) {
    if (
      info.audioFormat !== first.audioFormat ||
      info.numChannels !== first.numChannels ||
      info.sampleRate !== first.sampleRate ||
      info.bitsPerSample !== first.bitsPerSample
    ) {
      throw new Error("WAV format mismatch");
    }
  }
  const dataSize = infos.reduce((sum, info) => sum + info.data.length, 0);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(first.audioFormat, 20);
  header.writeUInt16LE(first.numChannels, 22);
  header.writeUInt32LE(first.sampleRate, 24);
  const byteRate = first.sampleRate * first.numChannels * (first.bitsPerSample / 8);
  header.writeUInt32LE(byteRate, 28);
  const blockAlign = first.numChannels * (first.bitsPerSample / 8);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(first.bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  const payload = Buffer.concat(infos.map((i) => i.data));
  ensureDir(dirname(outPath));
  writeFileSync(outPath, Buffer.concat([header, payload]));
}

/** Write an exact signed 16-bit mono PCM stream as WAV. */
export function writePcmWav(path: string, pcm: Buffer, sampleRateHz: number): void {
  if (pcm.length % 2 || !Number.isInteger(sampleRateHz) || sampleRateHz <= 0) throw new Error("Invalid mono PCM");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRateHz, 24); header.writeUInt32LE(sampleRateHz * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  ensureDir(dirname(path)); writeFileSync(path, Buffer.concat([header, pcm]));
}

export function exactTrimPcm(pcm: Buffer, seconds: number, sampleRateHz: number): {pcm: Buffer; trimSamples: number} {
  if (!Number.isFinite(seconds) || seconds < 0 || pcm.length % 2 || !Number.isInteger(sampleRateHz) || sampleRateHz <= 0) throw new Error("Invalid trim or PCM");
  const trimSamples = Math.floor(seconds * sampleRateHz + 0.5);
  if (trimSamples >= pcm.length / 2) throw new Error("Trim must be less than the segment sample count");
  return {pcm: pcm.subarray(0, pcm.length - trimSamples * 2), trimSamples};
}
