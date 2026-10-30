import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseWav, exactTrimPcm, writePcmWav } from './wav.js';

/** Convert once using FFmpeg to the composition PCM format, then trim exact samples. */
export function prepareVoicePcm(input: string, output: string, sampleRateHz: number, trimSec: number, ffmpegPath = process.env.VIDEOML_FFMPEG ?? "ffmpeg", expectedSha256?: string): {sampleCount: number; trimSamples: number} {
  const staging = mkdtempSync(join(dirname(output), '.vml-resample-'));
  const temp = join(staging, 'audio.wav');
  try {
    const verifyExecutable = () => {
      if (expectedSha256 && createHash('sha256').update(readFileSync(ffmpegPath)).digest('hex') !== expectedSha256) throw new Error('FFmpeg executable changed during generation');
    };
    verifyExecutable();
    const run = spawnSync(ffmpegPath, [
      '-nostdin', '-y', '-v', 'error', '-i', input, '-ac', '1', '-ar', String(sampleRateHz), '-c:a', 'pcm_s16le', temp,
    ], {encoding: 'utf8', timeout: 300000});
    if (run.error || run.status !== 0) throw new Error(`FFmpeg voice resampling failed: ${run.error?.message ?? run.stderr}`);
    verifyExecutable();
    const info = parseWav(readFileSync(temp), temp);
    if (info.audioFormat !== 1 || info.numChannels !== 1 || info.bitsPerSample !== 16 || info.sampleRate !== sampleRateHz) throw new Error('FFmpeg returned unexpected PCM format');
    const {pcm, trimSamples} = exactTrimPcm(info.data, trimSec, sampleRateHz);
    writePcmWav(output, pcm, sampleRateHz);
    return {sampleCount: pcm.length / 2, trimSamples};
  } finally { rmSync(staging, {recursive: true, force: true}); }
}
