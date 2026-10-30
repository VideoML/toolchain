import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export type FfmpegIdentity = {
  executablePath: string;
  executableSha256: string;
  versionOutputSha256: string;
  versionBuildOutput: string;
};
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
export function inspectFfmpeg(configured = process.env.VIDEOML_FFMPEG ?? 'ffmpeg'): FfmpegIdentity {
  const candidates = isAbsolute(configured) || configured.includes('/') || configured.includes('\\')
    ? [resolve(configured)]
    : (process.env.PATH ?? '').split(delimiter).map(dir => join(dir || '.', configured));
  let executablePath: string | undefined;
  for (const path of candidates) {
    try { if (existsSync(path)) { accessSync(path, constants.X_OK); executablePath = realpathSync(path); break; } } catch { /* Try next path. */ }
  }
  if (!executablePath) throw new Error(`FFmpeg executable not found: ${configured}`);
  const version = spawnSync(executablePath, ['-version'], {encoding:'utf8', timeout:300000, maxBuffer:1024*1024});
  if (version.error || version.status !== 0 || !version.stdout.trim()) throw new Error(`Cannot inspect FFmpeg version and build configuration: ${version.error?.message ?? version.stderr ?? version.status}`);
  return {executablePath, executableSha256:hash(readFileSync(executablePath)), versionOutputSha256:hash(version.stdout), versionBuildOutput:version.stdout};
}
