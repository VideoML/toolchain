import { loadBrowserController } from './browser-controller.js';
import type { SceneSnapshotRequest } from '@videoml/stdlib/effects';
import { awaitBrowserLaunch } from './render-lifecycle.js';
import { validateSnapshotPng, assertSnapshotTransferBudget } from './scene-snapshot-store.js';
type Snapshot = {
    sceneId: string;
    frame: number;
    png: string;
};
export type SceneSnapshotCaptureOptions = {
    request: SceneSnapshotRequest;
    signal: AbortSignal;
    width: number;
    height: number;
    fps: number;
    seed: number;
    assets: Readonly<Record<string, unknown>>;
    script: unknown;
    durationFrames: number;
    bundle: string;
    portableBundlePath?: string;
    portableComponents?: Array<{
        id: string;
        version: string;
    }>;
    customEffects?: unknown;
    snapshots: Snapshot[];
    encodedTransferAllowance: number;
    executablePath?: string;
};
/** Capture one browser-painted scene in its own isolated context. */
export async function captureSceneSnapshotPng(options: SceneSnapshotCaptureOptions): Promise<Uint8Array> {
    const { signal, width, height } = options;
    if (signal.aborted)
        throw new Error('SCENE_CAPTURE_CANCELLED');
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 4194304)
        throw new Error('SCENE_CAPTURE_LIMIT: dimensions');
    const { chromium } = loadBrowserController();
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, close: Promise<void> | undefined;
    const closeBrowser = () => close ??= (browser ? browser.close() : Promise.resolve());
    const launch = chromium.launch({ executablePath: options.executablePath ?? process.env.VIDEOML_CHROMIUM_EXECUTABLE_PATH });
    browser = await awaitBrowserLaunch(launch, { owned: true, signal, timeoutMs: 10000 });
    const abort = () => { void closeBrowser().catch(() => { }); };
    signal.addEventListener('abort', abort, { once: true });
    try {
        if (signal.aborted)
            throw new Error('SCENE_CAPTURE_CANCELLED');
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
        const blocked: string[] = [];
        await context.route('**/*', route => { blocked.push(route.request().url()); return route.abort(); });
        const page = await context.newPage();
        const warnings: string[] = [];
        page.on('console', message => { if (message.type() === 'warning' && message.text().includes('Component not found:'))
            warnings.push(message.text()); });
        await page.setContent(`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src data: blob:; worker-src 'none'; frame-src 'none'; object-src 'none'"><style>html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;background:#fdfdfd}</style><div id="root"></div>`);
        await page.evaluate(() => { (window as any).__blocked = []; document.addEventListener('securitypolicyviolation', event => (window as any).__blocked.push(event.violatedDirective)); });
        if (options.portableBundlePath)
            await page.addScriptTag({ path: options.portableBundlePath });
        await page.addScriptTag({ content: options.bundle });
        await page.evaluate(async (settings) => { const w = window as any; if (typeof w.mountVideoMLScene !== 'function')
            throw new Error('SCENE_CAPTURE_UNAVAILABLE'); w.__scene = await w.mountVideoMLScene(document.querySelector('#root'), settings); await w.__scene.seek(settings.frame); }, { width, height, fps: options.fps, seed: options.seed, assets: options.assets, captureSceneId: options.request.sceneId, frame: options.request.frame, script: options.script, durationFrames: options.durationFrames, portableComponents: options.portableComponents ?? [], portableMode: !!options.portableBundlePath, customEffects: options.customEffects ?? [], snapshots: options.snapshots, snapshotDecodedLimit: 48 * 1024 * 1024 });
        const policy = await page.evaluate(() => (window as any).__blocked as string[]);
        if (blocked.length || policy.length || warnings.length)
            throw new Error(`SCENE_CAPTURE_UNAVAILABLE: ${blocked[0] ?? policy[0] ?? warnings[0]}`);
        const png = await page.screenshot();
        if (signal.aborted)
            throw new Error('SCENE_CAPTURE_CANCELLED');
        const dimensions = validateSnapshotPng(png);
        assertSnapshotTransferBudget(png.byteLength, options.encodedTransferAllowance);
        await page.evaluate(async ({ encoded, width, height }) => { const binary = atob(encoded), bytes = Uint8Array.from(binary, c => c.charCodeAt(0)); const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' })); try {
            if (bitmap.width !== width || bitmap.height !== height)
                throw new Error('SCENE_CAPTURE_INVALID: decoded size');
        }
        finally {
            bitmap.close();
        } }, { encoded: png.toString('base64'), ...dimensions });
        if (signal.aborted)
            throw new Error('SCENE_CAPTURE_CANCELLED');
        await page.evaluate(async () => { await (window as any).__scene?.dispose(); });
        return png;
    }
    finally {
        signal.removeEventListener('abort', abort);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([closeBrowser(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('RENDER_CLEANUP_UNCONFIRMED: snapshot browser')), 10000); })]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
}
