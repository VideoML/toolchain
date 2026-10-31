import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const consumer=process.env.P03B_CONSUMER,project=process.env.P03B_PROJECT,framesDir=process.env.P03B_FRAMES,output=process.env.P03B_OUTPUT,executablePath=process.env.VIDEOML_CHROMIUM_EXECUTABLE_PATH;
if(!consumer||!project||!framesDir||!output||!executablePath)throw Error('P03B_CONSUMER, P03B_PROJECT, P03B_FRAMES, P03B_OUTPUT and Chromium are required');
const require=createRequire(`${consumer}/package.json`),{build}=require('esbuild'),{chromium}=require('playwright');
const {prepareSceneSnapshots}=await import(pathToFileURL(`${consumer}/node_modules/@videoml/renderer/src/prepare-scene-snapshots.ts`).href);
const {applyResolvedTimingToScript}=await import(pathToFileURL(require.resolve('@videoml/shared/resolved-timing')).href);
const xml=await readFile(`${project}/source/main.xml`,'utf8'),script=JSON.parse(await readFile(`${project}/script/main.json`,'utf8')),timing=JSON.parse(await readFile(`${project}/timing/main.resolved.json`,'utf8')),timeline=JSON.parse(await readFile(`${project}/timing/main.json`,'utf8'));
const resolved=applyResolvedTimingToScript(script,timing,timeline);const fps=timing.fps,sourceFrame=Number(xml.match(/&quot;sourceFrame&quot;:(\d+)/)?.[1]??xml.match(/"sourceFrame":(\d+)/)?.[1]);if(!Number.isSafeInteger(sourceFrame))throw Error('fixture sourceFrame missing');
const font='data:font/woff2;base64,'+(await readFile(`${project}/source/fonts/Geist.woff2`)).toString('base64');
const renderer=await build({entryPoints:[`${consumer}/node_modules/@videoml/renderer/src/frame-effect-browser.tsx`],bundle:true,write:false,platform:'browser',format:'iife'});
const snapshots=await prepareSceneSnapshots({script:resolved,width:320,height:240,fps,seed:timing.generationSeed,assets:{font},durationFrames:timing.durationFrames,bundle:renderer.outputFiles[0].text});
assert.deepEqual(snapshots.map(({sceneId,frame})=>({sceneId,frame})),[{sceneId:'source',frame:sourceFrame}]);
const player=await build({stdin:{contents:`import {createVmlPlayerController} from '@videoml/player';window.start=(xml,font,seed,snapshots)=>{const values=new Map(snapshots.map(x=>[JSON.stringify([x.sceneId,x.frame]),x.png]));window.requests=0;const provider={async capture({sceneId,frame,signal}){window.requests++;const data=values.get(JSON.stringify([sceneId,frame]));if(!data)throw Error('SCENE_CAPTURE_UNAVAILABLE');const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));if(signal.aborted){bitmap.close();throw Error('SCENE_CAPTURE_CANCELLED')}return {bitmap,close(){bitmap.close()}}}};window.player=createVmlPlayerController(document.getElementById('root'),{xml,autoPlay:false,effectSeed:seed,effectAssets:{font},effectSceneSnapshots:provider})};`,resolveDir:consumer,loader:'ts'},bundle:true,write:false,platform:'browser',format:'iife'});
const browser=await chromium.launch({executablePath});
try {
 const frames=[0,Math.floor(fps/2),fps,Math.floor(fps*1.5),fps,Math.floor(fps/2),0];
 const groups=[frames,frames.filter((_,i)=>i%2===0),frames.filter((_,i)=>i%2===1)];
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 for(const [partition,group] of groups.entries()) {
  const page=await browser.newPage({viewport:{width:320,height:240},deviceScaleFactor:1});
  try {
   await page.setContent('<style>html,body,#root{margin:0;width:320px;height:240px;background:#fdfdfd}vml,scene{display:block;position:absolute;inset:0}frame-effect{position:absolute;inset:0;width:100%;height:100%}</style><div id="root"></div>');
   await page.addScriptTag({content:player.outputFiles[0].text});
   await page.evaluate(({xml,font,seed,snapshots})=>window.start(xml,font,seed,snapshots),{xml,font,seed:timing.generationSeed,snapshots});
   for(const frame of group){await page.evaluate(frame=>window.player.seek(frame),frame);const data=await page.screenshot(),reference=await readFile(`${framesDir}/frame-${String(frame).padStart(6,'0')}.png`);assert.equal(hash(data),hash(reference),`partition ${partition} frame ${frame}`);await writeFile(`${output}/preview-${fps}-${partition}-${frame}.png`,data);console.log(JSON.stringify({fps,partition,frame,sha256:hash(data)}));}
   assert.equal(await page.evaluate(()=>window.requests),1);await page.evaluate(()=>window.player.dispose());
  } finally {await page.close()}
 }
} finally {await browser.close()}
