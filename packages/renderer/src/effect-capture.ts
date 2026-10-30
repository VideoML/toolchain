import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EffectConfig, EffectMountContext } from "@videoml/stdlib/effects";

/** Capture a trusted, local browser bundle that exposes mountVideoMLEffect(root, config, context). */
export async function captureEffectFrames(options:{bundlePath:string; config:EffectConfig; context:EffectMountContext; frames:number[]; outDir:string; executablePath?:string}):Promise<string[]> {
  const { chromium } = createRequire(import.meta.url)("playwright") as typeof import("playwright");
  const browser=await chromium.launch({executablePath:options.executablePath ?? process.env.VIDEOML_CHROMIUM_EXECUTABLE_PATH});
  try {
    const browserContext=await browser.newContext({viewport:{width:options.context.width,height:options.context.height},deviceScaleFactor:1});
    try {
      const page=await browserContext.newPage();
      await page.setContent('<!doctype html><style>html,body{margin:0;padding:0}</style><div id="root"></div>');
      await page.addScriptTag({path:resolve(options.bundlePath)});
      await page.evaluate(({config,context})=>{
        const api=window as any;
        if(typeof api.mountVideoMLEffect!=='function') throw new Error('Local bundle must expose mountVideoMLEffect');
        api.__videomlEffect=api.mountVideoMLEffect(document.querySelector('#root'),config,context);
      },{config:options.config,context:options.context});
      const paths:string[]=[]; mkdirSync(options.outDir,{recursive:true});
      let captureFailed=false;
      try {
        for (const frame of options.frames) {
          await page.evaluate(async frame=>{ await (window as any).__videomlEffect.seek(frame); },frame);
          const path=join(options.outDir,`frame-${String(frame).padStart(6,'0')}.png`);
          writeFileSync(path,await page.screenshot());paths.push(path);
        }
      } catch(error) { captureFailed=true; throw error; }
      finally {
        try { await page.evaluate(()=>{(window as any).__videomlEffect?.dispose();}); }
        catch(error) { if (!captureFailed) throw error; }
      }
      return paths;
    } finally { await browserContext.close(); }
  } finally { await browser.close(); }
}
