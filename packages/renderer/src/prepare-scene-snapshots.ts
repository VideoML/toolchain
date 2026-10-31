import { builtinSceneInputDescriptors, validateCustomSceneDescriptors } from '@videoml/stdlib/effects';
import { prepareSceneSnapshotPlan } from './scene-snapshot-plan.js';
import { SceneSnapshotStore } from './scene-snapshot-store.js';
import { captureSceneSnapshotPng } from './scene-snapshot-capture.js';
/** Prepare a composition's bounded, fixed-frame scene inputs before opening output pages. */
export async function prepareSceneSnapshots(options: {
    script: any;
    width: number;
    height: number;
    fps: number;
    seed: number;
    assets: Readonly<Record<string, unknown>>;
    durationFrames: number;
    bundle: string;
    signal?: AbortSignal;
    portableBundlePath?: string;
    portableComponents?: Array<{
        id: string;
        version: string;
    }>;
    customEffects?: unknown;
}) {
    const script = structuredClone(options.script), assets = structuredClone(options.assets);
    const descriptors = [...builtinSceneInputDescriptors, ...validateCustomSceneDescriptors(options.customEffects ?? [])];
    const plan = prepareSceneSnapshotPlan(script, descriptors);
    if (plan.some(item => item.frame >= options.durationFrames))
        throw new Error('SCENE_CAPTURE_INVALID: source frame outside composition');
    if (!plan.length)
        return [];
    const snapshots: Array<{
        sceneId: string;
        frame: number;
        png: string;
    }> = [];
    let encodedBytes = 0;
    const store = new SceneSnapshotStore(async (request, signal) => {
        // Conservatively reserve space for retained bytes, base64/transport copies and one maximum PNG.
        if (encodedBytes * 24 + 24 * 1024 * 1024 > 64 * 1024 * 1024)
            throw new Error('SCENE_CAPTURE_LIMIT: transfer budget');
        const bytes = await captureSceneSnapshotPng({ ...options, script, assets, request, signal, snapshots, encodedTransferAllowance: 56 * 1024 * 1024 - encodedBytes * 24 });
        encodedBytes += bytes.byteLength;
        if (encodedBytes * 24 > 64 * 1024 * 1024)
            throw new Error('SCENE_CAPTURE_LIMIT: transfer budget');
        snapshots.push({ ...request, png: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64') });
        return bytes;
    });
    const cancel = () => store.dispose();
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
        if (options.signal?.aborted)
            throw new Error('SCENE_CAPTURE_CANCELLED');
        await Promise.all(plan.map(request => store.capture(request, options.signal)));
        return snapshots;
    }
    finally {
        options.signal?.removeEventListener('abort', cancel);
        await store.close();
    }
}
/** Validate internally supplied completed snapshots before opening any consumer page. */
export function validatePreparedSceneSnapshots(script: any, customEffects: unknown, snapshots: Array<{
    sceneId: string;
    frame: number;
    png: string;
}>): void {
    const plan = prepareSceneSnapshotPlan(script, [...builtinSceneInputDescriptors, ...validateCustomSceneDescriptors(customEffects ?? [])]);
    if (!Array.isArray(snapshots) || snapshots.length !== plan.length)
        throw new Error('SCENE_CAPTURE_UNDECLARED: snapshot set');
    let total = 0;
    for (let i = 0; i < plan.length; i++) {
        const item = snapshots[i], expected = plan[i];
        if (!item || item.sceneId !== expected.sceneId || item.frame !== expected.frame || typeof item.png !== 'string' || (item.png.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(item.png)))
            throw new Error('SCENE_CAPTURE_UNDECLARED: snapshot identity');
        const size = item.png.length / 4 * 3 - (item.png.endsWith('==') ? 2 : item.png.endsWith('=') ? 1 : 0);
        if (size > 16 * 1024 * 1024)
            throw new Error('SCENE_CAPTURE_LIMIT: PNG');
        total += size;
        if (total * 24 > 64 * 1024 * 1024)
            throw new Error('SCENE_CAPTURE_LIMIT: transfer budget');
    }
}
