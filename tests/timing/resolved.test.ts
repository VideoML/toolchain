import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {qualifiedTimingId as id, applyResolvedTimingToScript, projectResolvedTimeline, type ResolvedTiming} from '@videoml/shared/resolved-timing';
import {writePcmWav} from '../../src/audio/wav.js';
import {verifyFrozenRenderAudio} from '../../packages/renderer/src/resolved-audio-node.js';
import {renderVideoFromScript} from '../../packages/renderer/src/video-render.js';
const interval=(kind:string,path:string[],startFrame:number,endFrame:number)=>({id:id(kind,path),startFrame,endFrame});
const frozen:ResolvedTiming={schemaVersion:1,fps:30,sampleRateHz:24000,durationFrames:30,generationSeed:0,leadInSamples:0,audioTotalSamples:0,
 scenes:[interval('scene',['scene:雪'],1,20)],cues:[interval('cue',['c'],2,5)],layers:[],components:[interval('component',['scene:雪','a:b'],3,10)],transitions:[interval('transition',['t'],15,20)],segments:[]};
test('frozen scene, cue, component, transition and duration override source timing',()=>{
 const source={scenes:[{id:'scene:雪',startSec:9,endSec:10,cues:[{id:'c',startSec:9,endSec:10}],components:[{id:'a:b',timing:{startSec:8,endSec:9}}]}],timeline:[{kind:'transition',id:'t',startSec:8,endSec:9}]};
 const projected=applyResolvedTimingToScript(source,frozen);assert.equal(projected.scenes[0].startSec,1/30);assert.equal(projected.scenes[0].cues[0].startSec,2/30);assert.equal(projected.scenes[0].components[0].timing.startSec,3/30);assert.equal(projected.timeline[0].startSec,15/30);assert.equal(projected.meta.durationSeconds,1);
 const changed=structuredClone(source);changed.scenes[0].startSec=100;changed.timeline[0].startSec=100;assert.deepEqual(applyResolvedTimingToScript(changed,frozen),projected);
 const missing=structuredClone(source);missing.scenes[0].id='other';assert.throws(()=>applyResolvedTimingToScript(missing,frozen),/Missing/);
});
test('render rejects FPS conflict before launching capture',async()=>{
 await assert.rejects(renderVideoFromScript({script:{scenes:[]},resolvedTiming:{...frozen,scenes:[],cues:[],components:[],transitions:[]},resolvedTimingRoot:'.',fps:24,framesDir:'unused',outputPath:'unused'} as any),/conflicts/);
});
test('export verifies frozen segment and composition audio',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'vml-verify-'));try {const pcm=Buffer.from([1,0,2,0]);const path=join(dir,'audio.wav');writePcmWav(path,pcm,24000);const wav=readFileSync(path);const hash=(x:Buffer)=>createHash('sha256').update(x).digest('hex');
 const timing:ResolvedTiming={...frozen,durationFrames:1,audioTotalSamples:2,scenes:[],cues:[interval('cue',['c'],0,1)],components:[],transitions:[],segments:[{id:id('segment',['c',0]),cueId:id('cue',['c']),track:'main',startSample:0,endSample:2,startFrame:0,endFrame:1,audioPath:'audio.wav',audioSha256:hash(wav),pcmSha256:hash(pcm),originalText:'x',expandedText:'x',trimSamples:0,pauseSamples:0,provenance:{provider:'dry-run',simulated:true,audioSha256:hash(wav),pcmSha256:hash(pcm),extensions:{}}}]};
 await verifyFrozenRenderAudio(timing,dir,path);const bad=Buffer.from(wav);bad[44]^=1;writeFileSync(path,bad);await assert.rejects(verifyFrozenRenderAudio(timing,dir,path),/integrity/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('transition children and narration cues are projected with ordered IDs',()=>{
 const t:ResolvedTiming={...frozen,scenes:[interval('scene',['a'],0,10),interval('scene',['b'],10,20)],cues:[interval('cue',['n'],1,4)],layers:[interval('transition-layer',['t','l'],15,19)],components:[interval('transition-component',['t','l','c'],16,18)],segments:[]};
 const source={scenes:[{id:'a',cues:[]},{id:'b',cues:[]}],timeline:[{kind:'transition',id:'t',layers:[{id:'l',components:[{id:'c'}]}]}]};
 const narration={sourceCueOrder:['n'],items:[{type:'tts',cueId:'n',startSec:100,endSec:200,segments:[]}]};
 const projected=applyResolvedTimingToScript(source,t,narration);assert.equal(projected.timeline[0].layers[0].components[0].timing.startSec,16/30);
 const updated=projectResolvedTimeline(narration,t);assert.equal(updated.items[0].startSec,1/30);assert.equal(updated.items[0].endSec,4/30);
 const reordered={...source,scenes:[source.scenes[1],source.scenes[0]]};assert.throws(()=>applyResolvedTimingToScript(reordered,t,narration),/order/);
});
test('silence-only and delayed trailing silence use authoritative total sample count',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'vml-silence-'));try {const path=join(dir,'silence.wav');writePcmWav(path,Buffer.alloc(12),24000);
 const t:ResolvedTiming={...frozen,scenes:[],cues:[],layers:[],components:[],transitions:[],durationFrames:1,audioTotalSamples:6,segments:[]};
 await verifyFrozenRenderAudio(t,dir,path);writePcmWav(path,Buffer.alloc(10),24000);await assert.rejects(verifyFrozenRenderAudio(t,dir,path),/duration/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('frozen composition rejects outside-root or symlink audio',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'vml-root-'));const outside=mkdtempSync(join(tmpdir(),'vml-other-'));
 try {const audio=join(outside,'audio.wav');writePcmWav(audio,Buffer.alloc(2),24000);const link=join(dir,'linked.wav');symlinkSync(audio,link);
 const t:ResolvedTiming={...frozen,scenes:[],cues:[],layers:[],components:[],transitions:[],durationFrames:1,audioTotalSamples:1,segments:[]};
 await assert.rejects(verifyFrozenRenderAudio(t,dir,audio),/outside/);await assert.rejects(verifyFrozenRenderAudio(t,dir,link),/symlink/);
 } finally {rmSync(dir,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
import {withVerifiedFrozenAudio} from '../../packages/renderer/src/resolved-audio-node.js';
test('encoder receives an owned verified copy even if original changes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'vml-stage-'));let staged='';
 try {const path=join(dir,'audio.wav');writePcmWav(path,Buffer.from([1,0]),24000);const original=readFileSync(path);const hash=(x:Buffer)=>createHash('sha256').update(x).digest('hex');
 const t:ResolvedTiming={...frozen,scenes:[],cues:[interval('cue',['c'],0,1)],layers:[],components:[],transitions:[],durationFrames:1,audioTotalSamples:1,segments:[{id:id('segment',['c',0]),cueId:id('cue',['c']),track:'main',startSample:0,endSample:1,startFrame:0,endFrame:1,originalText:'x',expandedText:'x',trimSamples:0,pauseSamples:0,audioPath:'audio.wav',audioSha256:hash(original),pcmSha256:hash(Buffer.from([1,0])),provenance:{provider:'dry-run',simulated:true,audioSha256:hash(original),pcmSha256:hash(Buffer.from([1,0])),extensions:{}}}]};
 await withVerifiedFrozenAudio(t,dir,path,async verified=>{staged=verified!;writeFileSync(path,'replaced');assert.deepEqual(readFileSync(staged),original);});assert.equal((await import('node:fs')).existsSync(staged),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
