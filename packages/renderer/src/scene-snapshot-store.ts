import type { SceneSnapshotRequest } from '@videoml/stdlib/effects';
const MAX_ENCODED = 16 * 1024 * 1024;
export function validateSnapshotPng(data: Uint8Array): {
    width: number;
    height: number;
} {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (data.byteLength < 33 || signature.some((byte, i) => data[i] !== byte))
        throw new Error('SCENE_CAPTURE_INVALID: PNG');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint32(8) !== 13 || String.fromCharCode(...data.subarray(12, 16)) !== 'IHDR')
        throw new Error('SCENE_CAPTURE_INVALID: IHDR');
    const width = view.getUint32(16), height = view.getUint32(20);
    if (!width || !height || width > 4096 || height > 4096 || width * height > 4194304 || data.byteLength > MAX_ENCODED)
        throw new Error('SCENE_CAPTURE_LIMIT: PNG');
    return { width, height };
}
/** Reserve screenshot, base64, transport and decode input copies before encoding. */
export function assertSnapshotTransferBudget(pngBytes:number,remainingBytes:number):void {
    if (!Number.isSafeInteger(pngBytes) || pngBytes < 0 || !Number.isSafeInteger(remainingBytes) || remainingBytes < 0 || pngBytes * 16 > remainingBytes)
        throw new Error('SCENE_CAPTURE_LIMIT: transfer budget');
}
/** Private per-composition completion coordinator; callers never receive mutable cached bytes. */
export class SceneSnapshotStore {
    private cache = new Map<string, Promise<void>>();
    private queue = Promise.resolve();
    private aborter = new AbortController();
    private disposed = false;
    private failure: unknown;
    constructor(private readonly render: (request: SceneSnapshotRequest, signal: AbortSignal) => Promise<Uint8Array>) { }
    capture(request: SceneSnapshotRequest, signal?: AbortSignal): Promise<void> {
        if (this.disposed || signal?.aborted)
            return Promise.reject(new Error('SCENE_CAPTURE_CANCELLED'));
        if (!request || typeof request.sceneId !== 'string' || !request.sceneId || !Number.isSafeInteger(request.frame) || request.frame < 0)
            return Promise.reject(new Error('SCENE_CAPTURE_INVALID'));
        const fixed = Object.freeze({ sceneId: request.sceneId, frame: request.frame }), key = JSON.stringify([fixed.sceneId, fixed.frame]);
        let shared = this.cache.get(key);
        if (!shared) {
            let timer: ReturnType<typeof setTimeout>;
            let stop: (() => void) = () => { }, timedOut = false;
            const interrupted = new Promise<never>((_, reject) => { stop = () => reject(this.failure ?? new Error(timedOut ? 'SCENE_CAPTURE_TIMEOUT' : 'SCENE_CAPTURE_CANCELLED')); this.aborter.signal.addEventListener('abort', stop, { once: true }); timer = setTimeout(() => { timedOut = true; this.dispose(); }, 10000); });
            const work = this.queue.then(async () => { if (this.disposed)
                throw new Error('SCENE_CAPTURE_CANCELLED'); const bytes = await this.render(fixed, this.aborter.signal); if (this.disposed)
                throw new Error('SCENE_CAPTURE_CANCELLED'); validateSnapshotPng(bytes); }).catch(error => { if (!this.disposed) {
                this.failure = error;
                this.dispose();
            } throw error; });
            this.queue = work.then(() => { }, () => { });
            shared = Promise.race([work, interrupted]).finally(() => { clearTimeout(timer); this.aborter.signal.removeEventListener('abort', stop); });
            this.cache.set(key, shared);
        }
        return new Promise((resolve, reject) => { let finished = false; const finish = (error?: unknown) => { if (finished)
            return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); if (error)
            reject(error);
        else
            resolve(); }; const cancel = () => finish(new Error('SCENE_CAPTURE_CANCELLED')); const timer = setTimeout(() => finish(new Error('SCENE_CAPTURE_TIMEOUT')), 10000); signal?.addEventListener('abort', cancel, { once: true }); shared!.then(() => finish(), finish); if (signal?.aborted)
            cancel(); });
    }
    dispose() { if (this.disposed)
        return; this.disposed = true; this.aborter.abort(); this.cache.clear(); }
    async close() { this.dispose(); let timer: ReturnType<typeof setTimeout> | undefined; try {
        await Promise.race([this.queue, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('RENDER_CLEANUP_UNCONFIRMED: snapshot capture did not settle')), 10000); })]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    } }
}
