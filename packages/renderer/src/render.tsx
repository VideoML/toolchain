import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, existsSync } from "fs";
import { cpus } from "os";
import { dirname, basename, join, resolve, isAbsolute } from "path";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";
import React from "react";
import { renderToString } from "react-dom/server";
import { clamp } from "./math.js";
import { RendererProvider, type VideoConfig } from "./context.js";

export type RenderFrameOptions = {
  component: React.ComponentType<any>;
  config: VideoConfig;
  frame: number;
  inputProps?: Record<string, unknown>;
};

export type RenderFrameFileOptions = RenderFrameOptions & {
  outPath: string;
};

export type RenderFramePngOptions = RenderFrameOptions & {
  outPath: string;
  deviceScaleFactor?: number;
  browser?: BrowserAdapter;
  autoClose?: boolean;
};

export type RenderFramesPngOptions = Omit<RenderFrameOptions, "frame"> & {
  outDir: string;
  startFrame?: number;
  endFrame?: number;
  framePattern?: string;
  deviceScaleFactor?: number;
  browser?: BrowserAdapter;
  autoClose?: boolean;
  workers?: number;
  onFrame?: (frame: number, path: string) => void;
  cleanFrames?: boolean; // If true, delete existing frames before rendering (default: true)
  effectRegistryBundlePath?: string; // Trusted local bundle registering custom frame effects
  effectStageTimeoutMs?: number; // Defaults to 30 seconds, capped at 300 seconds
  browserBundlePath?: string; // Deprecated: use browserBundlePaths instead
  browserBundlePaths?: string[]; // Multiple bundles to load in order (standard + custom)
};

export type RenderFramesHtmlOptions = Omit<RenderFrameOptions, "frame"> & {
  outDir: string;
  startFrame?: number;
  endFrame?: number;
  framePattern?: string;
  onFrame?: (frame: number, path: string) => void;
};

export type RenderFramesResult = {
  frames: Array<{ frame: number; path: string }>;
};

type BrowserAdapter = {
  newPage: () => Promise<PageAdapter>;
  newContext?: (options: {
    viewport: { width: number; height: number };
    deviceScaleFactor?: number;
  }) => Promise<BrowserContextAdapter>;
  close?: () => Promise<void>;
};

type BrowserContextAdapter = {
  newPage: () => Promise<PageAdapter>;
  close?: () => Promise<void>;
};

type PageAdapter = {
  route?: (pattern:string, handler:(route:any)=>Promise<void>)=>Promise<void>;
  setViewport?: (options: { width: number; height: number; deviceScaleFactor?: number }) => Promise<void>;
  setViewportSize?: (options: { width: number; height: number }) => Promise<void>;
  setContent: (html: string, options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" }) => Promise<void>;
  screenshot: (options: { type: "png"; omitBackground?: boolean }) => Promise<Buffer>;
  close?: () => Promise<void>;
  on?: (event: string, handler: (msg: any) => void) => void;
  addScriptTag?: (options: { url?: string; path?: string; content?: string }) => Promise<void>;
  evaluate?: <T = any>(pageFunction: (...args: any[]) => T | Promise<T>, ...args: any[]) => Promise<T>;
  waitForTimeout?: (timeout: number) => Promise<void>;
};

const require = createRequire(import.meta.url);

const ensureDir = (path: string) => {
  mkdirSync(path, { recursive: true });
};

const cleanFramesDir = (outDir: string, framePattern: string) => {
  if (!existsSync(outDir)) {
    return; // Directory doesn't exist, nothing to clean
  }

  try {
    const files = readdirSync(outDir);

    // Convert frame pattern to regex (e.g., "frame-%06d.png" -> /^frame-\d{6}\.png$/)
    const patternRegex = framePattern
      .replace(/%0(\d+)d/, (_, digits) => `\\d{${digits}}`)
      .replace(/%d/, '\\d+')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape other special chars

    const frameRegex = new RegExp(`^${patternRegex}$`);

    // Delete only files matching the frame pattern
    let deletedCount = 0;
    for (const file of files) {
      if (frameRegex.test(file)) {
        unlinkSync(join(outDir, file));
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.error(`Cleaned ${deletedCount} existing frame(s) from ${outDir}`);
    }
  } catch (err) {
    console.error(`Warning: Failed to clean frames directory: ${err}`);
  }
};

const applyViewport = async (
  page: PageAdapter,
  options: { width: number; height: number; deviceScaleFactor?: number },
): Promise<void> => {
  if (page.setViewport) {
    await page.setViewport(options);
    return;
  }
  if (page.setViewportSize) {
    await page.setViewportSize({ width: options.width, height: options.height });
    return;
  }
  throw new Error("Page does not support viewport sizing.");
};

const createPage = async (
  browser: BrowserAdapter,
  options: { width: number; height: number; deviceScaleFactor?: number },
): Promise<{ page: PageAdapter; closeContext?: () => Promise<void> }> => {
  if (browser.newContext) {
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: options.deviceScaleFactor,
    });
    const page = await context.newPage();
    return {
      page,
      closeContext: async () => {
        await context.close?.();
      },
    };
  }
  const page = await browser.newPage();
  return { page };
};

export const renderFrameToHtml = ({ component: Component, config, frame, inputProps }: RenderFrameOptions): string => {
  const maxFrame = Math.max(0, config.durationFrames - 1);
  const clampedFrame = clamp(Math.round(frame), 0, maxFrame);

  // Server-render for deterministic HTML snapshots (used by tests and CLI tooling)
  const markup = renderToString(
    <RendererProvider frame={clampedFrame} config={config}>
      {React.createElement(Component, inputProps ?? {})}
    </RendererProvider>,
  );

  // Serialize the render data for client-side hydration
  const renderData = {
    frame: clampedFrame,
    config,
    inputProps: inputProps ?? {},
  };

  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8" />',
    `<style>html,body{margin:0;padding:0;width:${config.width}px;height:${config.height}px;overflow:hidden;background:#fdfdfd;}</style>`,
    "</head>",
    `<body>`,
    `<div id="root" style="width:100%;height:100%">${markup}</div>`,
    `<script>window.__RENDER_DATA__ = ${JSON.stringify(renderData)};</script>`,
    "</body>",
    "</html>",
  ].join("");
};

export const renderFrameToFile = ({ outPath, ...options }: RenderFrameFileOptions): string => {
  const html = renderFrameToHtml(options);
  ensureDir(dirname(outPath));
  writeFileSync(outPath, html);
  return html;
};

const loadPlaywright = async (): Promise<{ chromium: { launch: (options?: { executablePath?: string }) => Promise<BrowserAdapter> } }> => {
  try {
    return require("playwright") as { chromium: { launch: (options?: { executablePath?: string }) => Promise<BrowserAdapter> } };
  } catch {
    try {
      return require("playwright-core") as { chromium: { launch: (options?: { executablePath?: string }) => Promise<BrowserAdapter> } };
    } catch {
      throw new Error("Playwright is required for PNG rendering. Install 'playwright' or 'playwright-core'.");
    }
  }
};

const formatFrameName = (pattern: string, frame: number): string => {
  const match = pattern.match(/%0(\d+)d/);
  if (match) {
    const width = Number(match[1]);
    const padded = String(frame).padStart(width, "0");
    return pattern.replace(match[0], padded);
  }
  if (pattern.includes("%d")) {
    return pattern.replace("%d", String(frame));
  }
  return pattern;
};

const resolveWorkerCount = (workers?: number): number => {
  if (workers == null) {
    return Math.max(1, Math.min(4, cpus().length || 1));
  }
  if (!Number.isFinite(workers) || workers <= 1) {
    return 1;
  }
  return Math.max(1, Math.floor(workers));
};

const hasFrameEffect = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some(hasFrameEffect);
    return (value as Record<string, unknown>).type === "FrameEffect" || Object.values(value).some(hasFrameEffect);
  };

export const renderFrameToPng = async ({
  outPath,
  deviceScaleFactor = 1,
  browser,
  autoClose,
  ...options
}: RenderFramePngOptions): Promise<Buffer> => {
  if (hasFrameEffect(options.inputProps?.script)) {
    await renderFramesToPng({component:options.component,config:options.config,inputProps:options.inputProps,outDir:dirname(outPath),framePattern:basename(outPath),startFrame:options.frame,endFrame:options.frame,deviceScaleFactor,browser,autoClose,workers:1,cleanFrames:false});
    return readFileSync(outPath);
  }
  const html = renderFrameToHtml(options);
  const providedBrowser = browser ?? (await loadPlaywright()).chromium.launch({ executablePath: process.env.VIDEOML_CHROMIUM_EXECUTABLE_PATH });
  const activeBrowser = await providedBrowser;
  const shouldClose = autoClose ?? !browser;
  const { page, closeContext } = await createPage(activeBrowser, {
    width: options.config.width,
    height: options.config.height,
    deviceScaleFactor,
  });
  await applyViewport(page, {
    width: options.config.width,
    height: options.config.height,
    deviceScaleFactor,
  });
  await page.setContent(html, { waitUntil: "load" });
  const buffer = await page.screenshot({ type: "png" });
  await page.close?.();
  await closeContext?.();
  if (shouldClose) {
    await activeBrowser.close?.();
  }
  ensureDir(dirname(outPath));
  writeFileSync(outPath, buffer);
  return buffer;
};

export const renderFramesToPng = async ({
  outDir,
  startFrame = 0,
  endFrame,
  framePattern = "frame-%06d.png",
  deviceScaleFactor = 1,
  browser,
  autoClose,
  workers,
  onFrame,
  cleanFrames = true, // Default: clean existing frames before rendering
  ...options
}: RenderFramesPngOptions): Promise<RenderFramesResult> => {
  const lastFrame = Math.min(
    options.config.durationFrames - 1,
    endFrame ?? options.config.durationFrames - 1,
  );
  const firstFrame = Math.max(0, startFrame);
  if (lastFrame < firstFrame) {
    return { frames: [] };
  }
  const automaticEffects = hasFrameEffect(options.inputProps?.script);
  let automaticBundle: string | undefined;
  if (automaticEffects && (!Number.isFinite(options.effectStageTimeoutMs ?? 30000) || (options.effectStageTimeoutMs ?? 30000) <= 0 || (options.effectStageTimeoutMs ?? 30000) > 300000)) throw new Error('FRAME_EFFECT_INVALID: stage timeout must be within 300 seconds');
  if (automaticEffects) {
    const { build } = await import("esbuild");
    const output = await build({entryPoints:[fileURLToPath(new URL("./frame-effect-browser.tsx",import.meta.url))],bundle:true,write:false,platform:"browser",format:"iife",target:"es2022"});
    automaticBundle = output.outputFiles[0].text;
  }

  const providedBrowser = browser ?? (await loadPlaywright()).chromium.launch({ executablePath: process.env.VIDEOML_CHROMIUM_EXECUTABLE_PATH });
  const activeBrowser = await providedBrowser;
  const shouldClose = autoClose ?? !browser;

  const frames: Array<{ frame: number; path: string }> = [];
  ensureDir(outDir);

  // Clean existing frames if requested (default: true)
  if (cleanFrames) {
    cleanFramesDir(outDir, framePattern);
  }
  const totalFrames = lastFrame - firstFrame + 1;
  const workerCount = Math.min(resolveWorkerCount(workers), totalFrames);
  const nextFrameRef = { value: firstFrame };

  const takeNextFrame = () => {
    if (nextFrameRef.value > lastFrame) {
      return null;
    }
    const next = nextFrameRef.value;
    nextFrameRef.value += 1;
    return next;
  };


  const renderWithPage = async (page: PageAdapter) => {
    if (automaticBundle) {
      if (!page.addScriptTag || !page.evaluate || !page.route) throw new Error("Frame effect rendering requires a browser page with request isolation");
      const timeoutMs=options.effectStageTimeoutMs ?? 30000;
      if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>300000)throw new Error('FRAME_EFFECT_INVALID: stage timeout must be within 300 seconds');
      const bounded=async <T,>(operation:()=>Promise<T>,stage:string):Promise<T>=>{
        let timer: ReturnType<typeof setTimeout>|undefined;
        try{return await Promise.race([operation(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void page.close?.().catch(()=>{});reject(new Error(`FRAME_EFFECT_TIMEOUT: ${stage}`));},timeoutMs);})]);}
        finally{if(timer)clearTimeout(timer);}
      };
      const blockedRequests:string[]=[];
      await bounded(()=>page.route!('**/*',async route=>{const url=route.request().url();if(/^(https?:|file:|ftp:)/i.test(url)){blockedRequests.push(url);await route.abort('blockedbyclient');}else await route.continue();}),'request isolation');
      await bounded(()=>page.setContent(`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src data: blob:; worker-src 'none'; frame-src 'none'; object-src 'none'"><style>html,body{margin:0;width:${options.config.width}px;height:${options.config.height}px;overflow:hidden;background:#fdfdfd}</style><div id="root" style="width:100%;height:100%"></div>`,{waitUntil:"load"}),"page setup");
      await bounded(()=>page.evaluate!(() => { (window as any).__videomlBlockedPolicies=[];document.addEventListener('securitypolicyviolation',event=>(window as any).__videomlBlockedPolicies.push(`${event.violatedDirective}: ${event.blockedURI}`)); }),"policy setup");
      if(options.effectRegistryBundlePath)await bounded(()=>page.addScriptTag!({path:resolve(options.effectRegistryBundlePath!)}),"custom registry setup");
      await bounded(()=>page.addScriptTag!({content:automaticBundle}),"effect bundle setup");
      let failed = false;
      try {
        for (;;) {
          const frame = takeNextFrame(); if (frame == null) break;
          await bounded(()=>page.evaluate!(async (args: any) => (window as any).videomlFrameEffectRender(args), {script:options.inputProps?.script,frame,config:options.config,assets:options.inputProps?.effectAssets ?? {},seed:options.inputProps?.effectSeed ?? 0}),"mount or seek");
          const policyViolations=await bounded(()=>page.evaluate!(()=>(window as any).__videomlBlockedPolicies as string[]),'policy check');
          if(blockedRequests.length||policyViolations.length)throw new Error(`FRAME_EFFECT_NETWORK_BLOCKED: ${blockedRequests[0] ?? policyViolations[0]}`);
          const buffer = await bounded(()=>page.screenshot({type:"png"}),"screenshot"); const outPath=join(outDir,formatFrameName(framePattern,frame));ensureDir(dirname(outPath));writeFileSync(outPath,buffer);frames.push({frame,path:outPath});onFrame?.(frame,outPath);
        }
      } catch (error) { failed=true; if(error instanceof Error && error.message.startsWith('FRAME_EFFECT_TIMEOUT:'))throw error; const violations=await bounded(()=>page.evaluate!(()=>(window as any).__videomlBlockedPolicies as string[]),'error policy check').catch(()=>[] as string[]); if(blockedRequests.length||violations.length) throw new Error(`FRAME_EFFECT_NETWORK_BLOCKED: ${blockedRequests[0] ?? violations[0]}`); throw error; }
      finally { try { await bounded(()=>page.evaluate!(() => (window as any).videomlFrameEffectDispose()),"dispose"); } catch (error) { if (!failed) throw error; } }
      return;
    }
    // Resolve browser bundle paths - support both single and multiple bundles
    let bundlePaths: string[] = [];

    if (options.browserBundlePaths) {
      // New API: multiple bundles (e.g., standard + custom)
      bundlePaths = options.browserBundlePaths.map(path =>
        isAbsolute(path) ? path : resolve(process.cwd(), path)
      );
    } else if (options.browserBundlePath) {
      // Legacy API: single bundle
      const resolvedPath = isAbsolute(options.browserBundlePath)
        ? options.browserBundlePath
        : resolve(process.cwd(), options.browserBundlePath);
      bundlePaths = [resolvedPath];
    } else if (process.env.BABULUS_BROWSER_BUNDLE) {
      // Environment variable fallback
      const resolvedPath = isAbsolute(process.env.BABULUS_BROWSER_BUNDLE)
        ? process.env.BABULUS_BROWSER_BUNDLE
        : resolve(process.cwd(), process.env.BABULUS_BROWSER_BUNDLE);
      bundlePaths = [resolvedPath];
    } else {
      // Default: look for standard bundle
      bundlePaths = [join(process.cwd(), 'public', 'babulus-standard.js')];
    }

    // Filter to only existing bundles
    const existingBundles = bundlePaths.filter(path => existsSync(path));
    const useBrowserBundle = existingBundles.length > 0;

    if (useBrowserBundle) {
      console.error(`[Render] Using browser bundles for client-side rendering: ${existingBundles.join(', ')}`);
    }

    // For browser bundle mode, set up the page once with all scripts loaded
    let pageInitialized = false;

    for (;;) {
      const frame = takeNextFrame();
      if (frame == null) {
        return;
      }

      if (useBrowserBundle) {
        // Initialize page with bundles only once per worker
        if (!pageInitialized) {
          // Client-side rendering with browser bundle (supports hooks)
          const html = [
            "<!doctype html>",
            "<html>",
            "<head>",
            '<meta charset="utf-8" />',
            `<style>html,body{margin:0;padding:0;width:${options.config.width}px;height:${options.config.height}px;overflow:hidden;background:#fdfdfd;}</style>`,
            "</head>",
            `<body>`,
            `<div id="root" style="width:100%;height:100%;background:#fdfdfd;"></div>`,
            "</body>",
            "</html>",
          ].join("");

          await page.setContent(html, { waitUntil: "load" });

          // Enable console logging from the page
          page.on?.('console', (msg) => {
            const type = msg.type();
            const prefix = `[Browser ${type}]`;
            if (type === 'error' || type === 'warning') {
              console.error(prefix, msg.text());
            } else {
              console.log(prefix, msg.text());
            }
          });

          // Load React and ReactDOM from CDN first
          await page.addScriptTag?.({
            url: 'https://unpkg.com/react@18/umd/react.production.min.js',
          });
          await page.addScriptTag?.({
            url: 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
          });

          // Load all browser bundles in order (standard + custom components)
          for (const bundlePath of existingBundles) {
            await page.addScriptTag?.({ path: bundlePath });
          }

          pageInitialized = true;
        }

        // Call renderFrame with the data
        const renderResult = await page.evaluate?.(
          async ({ script, frame, config }) => {
            try {
              const renderFrame = (window as any).renderFrame;
              if (!renderFrame) {
                return { success: false, error: 'renderFrame function not found on window' };
              }
              await renderFrame({ script, frame, config, inputProps: {} });
              return { success: true };
            } catch (error: any) {
              return { success: false, error: error.message };
            }
          },
          {
            script: options.inputProps?.script,
            frame,
            config: options.config,
          }
        );

        if (renderResult && !renderResult.success) {
          console.error(`[Render] Frame ${frame} failed:`, renderResult.error);
        }

        // Wait a bit more for any animations to settle
        await page.waitForTimeout?.(100);
      } else {
        // Fallback to SSR (doesn't support hooks)
        const html = renderFrameToHtml({ ...options, frame });
        await page.setContent(html, { waitUntil: "load" });
      }

      const buffer = await page.screenshot({ type: "png" });
      const fileName = formatFrameName(framePattern, frame);
      const outPath = join(outDir, fileName);
      ensureDir(dirname(outPath));
      writeFileSync(outPath, buffer);
      frames.push({ frame, path: outPath });
      onFrame?.(frame, outPath);
    }
  };

  const setupBounded=async <T,>(operation:()=>Promise<T>,stage:string):Promise<T>=>{
    if(!automaticBundle)return operation();let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([operation(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void activeBrowser.close?.().catch(()=>{});reject(new Error(`FRAME_EFFECT_TIMEOUT: ${stage}`));},options.effectStageTimeoutMs ?? 30000);})]);}finally{if(timer)clearTimeout(timer);}
  };
  const setupResults = await Promise.allSettled(Array.from({length:workerCount},async()=>{
    const pair=await setupBounded(()=>createPage(activeBrowser,{width:options.config.width,height:options.config.height,deviceScaleFactor}),'page creation');
    try {await setupBounded(()=>applyViewport(pair.page,{width:options.config.width,height:options.config.height,deviceScaleFactor}),'viewport setup');return pair;}
    catch(error){void pair.page.close?.().catch(()=>{});void pair.closeContext?.().catch(()=>{});throw error;}
  }));
  const workersPool=setupResults.filter((item):item is PromiseFulfilledResult<Awaited<ReturnType<typeof createPage>>>=>item.status==='fulfilled').map(item=>item.value);
  const setupFailure=setupResults.find((item):item is PromiseRejectedResult=>item.status==='rejected');
  if(setupFailure){for(const {page,closeContext} of workersPool){void page.close?.().catch(()=>{});void closeContext?.().catch(()=>{});}if(shouldClose)void activeBrowser.close?.().catch(()=>{});throw setupFailure.reason;}

  let renderFailure: unknown;
  try {
    const outcomes = await Promise.allSettled(workersPool.map(async ({ page, closeContext }) => {
      let failure: unknown;
      try { await renderWithPage(page); } catch (error) { failure=error; }
      const closeBounded=async (operation:()=>Promise<void>)=>{if(!automaticBundle)return operation();let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([operation(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('FRAME_EFFECT_TIMEOUT: cleanup')),options.effectStageTimeoutMs ?? 30000);})]);}finally{if(timer)clearTimeout(timer);}};
      try { await closeBounded(async()=>{await page.close?.();}); } catch (error) { failure ??= error; }
      try { await closeBounded(async()=>{await closeContext?.();}); } catch (error) { failure ??= error; }
      if (failure) throw failure;
    }));
    for (const outcome of outcomes) if (outcome.status === 'rejected') {renderFailure=outcome.reason;break;}
  } finally {
    if (shouldClose) try { if(automaticBundle){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([activeBrowser.close?.(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('FRAME_EFFECT_TIMEOUT: browser cleanup')),options.effectStageTimeoutMs ?? 30000);})]);}finally{if(timer)clearTimeout(timer);}}else await activeBrowser.close?.(); } catch (error) { renderFailure ??= error; }
  }
  if (renderFailure) throw renderFailure;

  frames.sort((a, b) => a.frame - b.frame);
  return { frames };
};

export const renderFramesToHtml = ({
  outDir,
  startFrame = 0,
  endFrame,
  framePattern = "frame-%06d.html",
  onFrame,
  ...options
}: RenderFramesHtmlOptions): RenderFramesResult => {
  const lastFrame = Math.min(
    options.config.durationFrames - 1,
    endFrame ?? options.config.durationFrames - 1,
  );
  const firstFrame = Math.max(0, startFrame);
  if (lastFrame < firstFrame) {
    return { frames: [] };
  }

  const frames: Array<{ frame: number; path: string }> = [];
  ensureDir(outDir);
  for (let frame = firstFrame; frame <= lastFrame; frame += 1) {
    const html = renderFrameToHtml({ ...options, frame });
    const fileName = formatFrameName(framePattern, frame);
    const outPath = join(outDir, fileName);
    ensureDir(dirname(outPath));
    writeFileSync(outPath, html);
    frames.push({ frame, path: outPath });
    onFrame?.(frame, outPath);
  }

  return { frames };
};
