import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const names=['domain-warp','ridged-burn','whip-pan','sdf-iris','ripple-waves','gravitational-lens','cinematic-zoom','chromatic-split','glitch','swirl-vortex','thermal-distortion','flash-through-white','cross-warp-morph','light-leak'];
test('shader reference, alpha, options and real XML player',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'videoml-p08-tests-'));let browser;
 try{
  for(const name of ['reference','alpha','options','player'])await build({entryPoints:[resolve(`tests/transitions/fixtures/p08-${name}.ts`)],bundle:true,platform:'browser',format:'iife',outfile:join(dir,`${name}.js`)});
  browser=await chromium.launch({executablePath:process.env.VIDEOML_CHROMIUM_EXECUTABLE_PATH});const page=await browser.newPage();
  for(const name of ['reference','alpha','options','player'])await page.addScriptTag({path:join(dir,`${name}.js`)});
  for(const name of names){const reference=await page.evaluate(name=>window.compareReference(name),name);for(const [actual,expected] of reference)assert.equal(actual,expected,`${name} upstream`);const alpha=await page.evaluate(name=>window.checkAlpha(name),name);assert.deepEqual(alpha[0],[255,0,0,64]);assert.deepEqual(alpha[2],[0,0,255,128]);const player=await page.evaluate(name=>window.checkP08Player(name),name);assert.equal(player.values[1],player.values[3],`${name} repeated frame`);assert.ok(new Set(player.values).size>=3,`${name} motion`);assert.equal(player.disposals,2);}
  const options=await page.evaluate(()=>window.checkP08Options());assert.deepEqual(options.pixel,[128,0,127,255]);assert.equal(options.strict,true);assert.deepEqual(options.diagnostics,['CROSSFADE_FALLBACK']);
  const errors=await page.evaluate(()=>window.checkP08PlayerErrors());assert.match(errors[0],/SCENE_CAPTURE_UNAVAILABLE/);assert.match(errors[1],/TRANSITION_INVALID/);assert.match(errors[2],/TRANSITION_INVALID/);
  await assert.rejects(page.evaluate(()=>window.checkP08Player('domain-wapr')),/TRANSITION_INVALID/);
  const defaultDuration=await page.evaluate(()=>window.checkP08Player('domain-warp',true));assert.ok(new Set(defaultDuration.values).size>=3);assert.equal(defaultDuration.values[1],defaultDuration.values[3]);
  const autoplay=await page.evaluate(()=>window.checkP08Autoplay());assert.ok(autoplay.count>=2);assert.equal(autoplay.count,autoplay.paused);
  assert.deepEqual(await page.evaluate(()=>window.checkP08Insert()),[['block','none'],['none','none'],['none','block'],['none','block']]);
  await build({entryPoints:[resolve('packages/renderer/src/frame-effect-browser.tsx')],bundle:true,platform:'browser',format:'iife',outfile:join(dir,'scene.js')});
  const scenePage=await browser.newPage({viewport:{width:320,height:180}});await scenePage.setContent('<div id="root" style="width:320px;height:180px"></div>');await scenePage.addScriptTag({path:join(dir,'scene.js')});
  const semantics=await scenePage.evaluate(async()=>{const script={meta:{durationSeconds:6},scenes:[{id:'a',startSec:0,endSec:5,cues:[{id:'a1',startSec:2,endSec:4,text:'WRONG'}],components:[]},{id:'b',startSec:2,endSec:5,enter:{effect:'fade',durationSeconds:1},cues:[{id:'b1',startSec:2,endSec:2.5,text:'FIRST'},{id:'b2',startSec:2.5,endSec:4,text:'SECOND'}],components:[{id:'title',type:'Title',bindings:{text:'cue.text'},props:{fontSize:30,color:'white'}}]}],timeline:[]};const controller=window.mountVideoMLScene(document.querySelector('#root'),{script,captureSceneId:'b',width:320,height:180,fps:4,seed:0,assets:{},durationFrames:24});const result=[];for(const frame of [9,11]){await controller.seek(frame);const root=document.querySelector('#root');result.push({text:root.textContent,opacity:root.querySelector('[style*=opacity]')?.style.opacity});}controller.dispose();return result;});
  assert.deepEqual(semantics,[{text:'FIRST',opacity:'0.25'},{text:'SECOND',opacity:'0.75'}]);await scenePage.close();
 }finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
});
