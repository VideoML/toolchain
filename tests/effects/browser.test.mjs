import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { captureEffectFrames } from '../../packages/renderer/src/effect-capture.ts';
const executablePath=process.env.VIDEOML_CHROMIUM_EXECUTABLE_PATH;
if (!executablePath) throw new Error('VIDEOML_CHROMIUM_EXECUTABLE_PATH required');
const out=process.env.P04_OUTPUT_DIR ?? mkdtempSync(join(tmpdir(),'videoml-effects-'));
mkdirSync(out,{recursive:true});
const alias={'@videoml/stdlib/effects':resolve('../stdlib/src/effects/index.ts'),'@videoml/stdlib/dom':resolve('../stdlib/src/dom/index.ts')};
const options={bundle:true,platform:'browser',format:'iife',alias,logLevel:'silent'};
test('shared DOM and canvas effects conform in player and renderer and capture identical PNGs', async()=>{
  for (const mode of ['player','renderer']) {
    const outfile=join(out,`${mode}.js`);
    await build({...options,entryPoints:['tests/effects/browser-fixture.ts'],outfile,define:{MODE:JSON.stringify(mode)}});
    const result=spawnSync(process.execPath,['tests/conformance/run.mjs','--fixture-path',resolve(outfile),'--output',resolve(out,mode)],{env:process.env,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr+result.stdout);
  }
  const frames=[0,1,9,10,15,19,20,29];
  await captureEffectFrames({bundlePath:join(out,'renderer.js'),config:{id:'test/dom-canvas',version:'1',parameters:{color:'#40c080'},startFrame:0,endFrame:30},context:{width:1280,height:720,fps:30,seed:0,assets:{}},frames,outDir:join(out,'capture'),executablePath});
  for(const frame of frames) assert.deepEqual(readFileSync(join(out,'player',`sequential-frame-${String(frame).padStart(4,'0')}.png`)),readFileSync(join(out,'capture',`frame-${String(frame).padStart(6,'0')}.png`)));
});
test('player controls, legacy cleanup and React canvas adapter operate in browser', async()=>{
  const outfile=join(out,'player-react.js');await build({...options,entryPoints:['tests/effects/player-react-fixture.tsx'],outfile});
  const browser=await chromium.launch({executablePath});
  try { const page=await browser.newPage();await page.setContent('<!doctype html><body></body>');await page.addScriptTag({path:outfile});const result=await page.evaluate(()=>window.runPlayerReactChecks());assert.ok(result.unmount>0); }
  finally {await browser.close();}
});

test('capture preserves a frame failure when disposal also fails', async()=>{
  const {writeFileSync}=await import('node:fs');const path=join(out,'failing-effect.js');
  writeFileSync(path,`window.mountVideoMLEffect=()=>({async seek(){throw Error('original seek failure')},dispose(){throw Error('cleanup failure')}})`);
  await assert.rejects(captureEffectFrames({bundlePath:path,config:{id:'x',version:'1',parameters:{},startFrame:0,endFrame:1},context:{width:32,height:32,fps:30,seed:0,assets:{}},frames:[0],outDir:join(out,'failed'),executablePath}),/original seek failure/);
});
