import { chmodSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyResolvedAudio, type ResolvedTiming } from '@videoml/shared/resolved-timing';

/** Resolve only regular files beneath root, without traversing symlinks. */
function readBounded(root: string, relativePath: string): Buffer {
  const base = realpathSync(root);
  let current = base;
  for (const part of relativePath.split('/')) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('Resolved audio path traverses a symlink');
  }
  const actual = realpathSync(current);
  if (!actual.startsWith(base + sep) || !lstatSync(actual).isFile() || lstatSync(actual).size > 250 * 1024 * 1024) throw new Error('Invalid resolved audio file');
  return readFileSync(actual);
}
export async function verifyFrozenRenderAudio(timing: ResolvedTiming, root: string, audioPath?: string | null): Promise<Buffer | null> {
  if (timing.audioTotalSamples === 0 && audioPath) throw new Error('Frozen timing contains no composition audio');
  if (timing.audioTotalSamples > 0 && !audioPath) throw new Error('Frozen timing requires its composition audio');
  let compositionRelative: string | undefined;
  if (audioPath) {
    compositionRelative = relative(resolve(root), resolve(audioPath)).split(sep).join('/');
    if (!compositionRelative || compositionRelative.startsWith('../') || compositionRelative === '..' || compositionRelative.startsWith('/')) throw new Error('Composition audio is outside the frozen root');
  }
  const composition = compositionRelative ? readBounded(root, compositionRelative) : null;
  const canonical = await verifyResolvedAudio(timing, async path => Uint8Array.from(readBounded(root,path)).buffer,
    composition ? async () => Uint8Array.from(composition).buffer : undefined);
  return canonical ? Buffer.from(canonical) : null;
}

/** Only a private read-only copy of the verified bytes is passed to the encoder. */
export async function withVerifiedFrozenAudio<T>(timing: ResolvedTiming, root: string, audioPath: string | null | undefined, run: (verifiedPath: string | null) => Promise<T>): Promise<T> {
  const bytes = await verifyFrozenRenderAudio(timing, root, audioPath);
  if (!bytes) return run(null);
  const dir = mkdtempSync(join(tmpdir(), 'videoml-frozen-render-'));
  try {
    const path = join(dir, 'audio.wav');
    writeFileSync(path, bytes, {flag:'wx', mode:0o400}); chmodSync(path,0o400);
    return await run(path);
  } finally { rmSync(dir, {recursive:true,force:true}); }
}
