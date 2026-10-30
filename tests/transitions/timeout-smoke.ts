import {captureTransitionFrames} from '../../packages/renderer/src/transition-capture';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='/private/tmp/videoml-execution/p07-bundles/';
const options={fromBundlePath:base+'stall.js',toBundlePath:base+'to.js',compositorBundlePath:base+'compositor.js',width:320,height:240,fps:24,seed:71,assets:{accent:'fixture'},fromSceneId:'scene-a',toSceneId:'scene-b',startFrame:0,endFrame:24,frames:[0],shader:'crossfade' as const,outDir:'/private/tmp/videoml-execution/p07-timeouts',executablePath:'/Users/home/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell',stageTimeoutMs:250};
for(const mode of ['mount','seek','dispose']) {
 const never='new Promise(()=>{})';
 await writeFile(base+'stall.js',`window.mountVideoMLScene=${mode==='mount'?`()=>${never}`:`()=>({seek:${mode==='seek'?`()=>${never}`:'()=>{}'},dispose:${mode==='dispose'?`()=>${never}`:'()=>{}'}})`}`);
 await assert.rejects(captureTransitionFrames(options),new RegExp(mode==='mount'?'scene mount timed out':mode==='seek'?'scene seek timed out':'dispose timed out'));
 console.log(`${mode}: bounded timeout passed`);
}
const abort=new AbortController();abort.abort();await assert.rejects(captureTransitionFrames({...options,signal:abort.signal}),/aborted/);console.log('pre-launch abort passed');
const duringLaunch=new AbortController();const starting=captureTransitionFrames({...options,signal:duringLaunch.signal,stageTimeoutMs:5000});duringLaunch.abort();await assert.rejects(starting,/aborted/);console.log('in-flight launch cancellation passed');
