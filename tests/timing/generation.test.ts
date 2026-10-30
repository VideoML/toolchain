import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { generateComposition } from '../../src/generate.js';
import { parseWav } from '../../src/audio/wav.js';
import { renderVideoFromScript } from '../../packages/renderer/src/video-render.js';
import { verifyFrozenRenderAudio } from '../../packages/renderer/src/resolved-audio-node.js';
const fake=resolve('tests/auritus/fake-bridge.cjs');
test('sample assembly uses exact trim and silence between segments', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-exact-'));
 try {
  const composition={id:'exact',voiceover:{provider:'auritus',sampleRateHz:24000,trimEndSeconds:.05},timeline:[{id:'scene',title:'scene',items:[{kind:'cue' as const,id:'cue',label:'cue',bullets:[],segments:[{kind:'text' as const,text:'one'},{kind:'pause' as const,pause:{kind:'pause' as const,mode:'fixed' as const,seconds:3/24000}},{kind:'pause' as const,pause:{kind:'pause' as const,mode:'fixed' as const,seconds:4/24000}},{kind:'text' as const,text:'two',trimEndSec:0}]}]}]};
  const audio=join(dir,'public','videoml','out.wav');
  const result=await generateComposition({composition,dslPath:join(dir,'in.xml'),scriptOut:join(dir,'script.json'),timelineOut:join(dir,'timeline.json'),audioOut:audio,outDir:join(dir,'.videoml','out'),config:{providers:{auritus:{python:fake}}},verboseLogs:false});
  const info=parseWav(readFileSync(audio)); assert.equal(info.sampleRate,24000); assert.equal(info.data.length/2,46807);
  const frozen=JSON.parse(readFileSync(join(dir,'timeline.resolved.json'),'utf8'));
  assert.deepEqual(frozen.segments.map((segment:any)=>[segment.startSample,segment.endSample,segment.trimSamples,segment.pauseSamples]),[[0,22800,1200,7],[22807,46807,0,0]]);
  assert.equal(frozen.segments[0].provenance.requestKey,'a'.repeat(64));
  assert.equal(frozen.segments[0].originalText,'one');
  assert.equal(frozen.generationSeed,0); assert.equal(frozen.audioTotalSamples,46807);
  assert.ok(result.frozenAudioPath!.startsWith(join(dir,'.videoml','out')+'/'));
  await verifyFrozenRenderAudio(frozen,join(dir,'.videoml','out'),result.frozenAudioPath);
  const preserved=readFileSync(result.frozenAudioPath!); let stagedPath='';
  await renderVideoFromScript({script:JSON.parse(readFileSync(join(dir,'script.json'),'utf8')),timeline:JSON.parse(readFileSync(join(dir,'timeline.json'),'utf8')),resolvedTiming:frozen,resolvedTimingRoot:join(dir,'.videoml','out'),audioPath:result.frozenAudioPath,framesDir:join(dir,'frames'),outputPath:join(dir,'video.mp4'),
    renderFrames:async options=>{assert.equal(options.config.fps,30);(await import('node:fs')).writeFileSync(result.frozenAudioPath!,'changed after verification');return {frames:[{frame:0,path:'fixture.png'}]};},
    encode:async options=>{stagedPath=options.audioPath!;assert.notEqual(stagedPath,result.frozenAudioPath);assert.deepEqual(readFileSync(stagedPath),preserved);},
  });
  assert.equal((await import('node:fs')).existsSync(stagedPath),false);

 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('visual-only and no-pause dry-run require no precreated output directory', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-no-pause-'));
 try {const base={dslPath:join(dir,'in.xml'),scriptOut:join(dir,'script.json'),timelineOut:join(dir,'timeline.json'),audioOut:join(dir,'audio.wav'),outDir:join(dir,'tmp'),config:{},verboseLogs:false};
  const cue={kind:'cue' as const,id:'cue',label:'cue',bullets:[],segments:[{kind:'text' as const,text:'hello'}]};
  await generateComposition({...base,composition:{id:'dry',voiceover:{provider:'dry-run'},timeline:[{id:'scene',title:'scene',items:[cue]}]}});
  const simulated=JSON.parse(readFileSync(join(dir,'timeline.resolved.json'),'utf8')); assert.equal(simulated.segments[0].provenance.simulated,true); assert.equal(simulated.segments[0].provenance.provider,'dry-run');
  await generateComposition({...base,composition:{id:'visual',timeline:[{id:'scene',title:'scene',items:[],time:{start:0,end:1}}]}});
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('Gaussian pauses draw in document order and persist selected samples', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-gaussian-'));
 try {
  const pause=()=>({kind:'pause' as const,mode:'gaussian' as const,mean:.2,std:.05,min:0,max:1});
  const composition={id:'gaussian',voiceover:{provider:'dry-run',seed:0},timeline:[{kind:'narration' as const,id:'n',time:{start:0},items:[pause()]},{id:'s',title:'s',time:{start:0,end:1},items:[pause()]}]};
  const opts={composition,dslPath:join(dir,'in.xml'),scriptOut:join(dir,'script.json'),timelineOut:join(dir,'timeline.json'),outDir:join(dir,'out'),config:{},verboseLogs:false};
  await generateComposition(opts); const first=JSON.parse(readFileSync(opts.timelineOut,'utf8')); await generateComposition(opts); const second=JSON.parse(readFileSync(opts.timelineOut,'utf8'));
  const pauses=first.items.filter((x:any)=>x.type==='pause'); assert.deepEqual(pauses.map((x:any)=>[x.sceneId,x.sampleCount]),[['s',6061],['narration:n',6752]]);
  assert.deepEqual(first.items,second.items);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('overlapping narration is rejected even without an audio output', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-overlap-'));
 try {const cue=(id:string)=>({kind:'cue' as const,id,label:id,bullets:[],segments:[{kind:'text' as const,text:id}]});
  const composition={id:'overlap',voiceover:{provider:'auritus'},timeline:[{id:'s',title:'s',items:[cue('a')]},{kind:'narration' as const,id:'n',time:{start:0},items:[cue('b')]}]};
  await assert.rejects(generateComposition({composition,dslPath:join(dir,'in.xml'),scriptOut:join(dir,'script.json'),timelineOut:join(dir,'timeline.json'),outDir:join(dir,'out'),config:{providers:{auritus:{python:fake}}},verboseLogs:false}),/Overlapping narration/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('generation reuses v1 cache and invalidates on speed or content changes', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-gen-cache-')); const old=process.env.VML_FAKE_CACHE; process.env.VML_FAKE_CACHE='1';
 try {
  const composition={id:'cache',voiceover:{provider:'auritus',speed:1},timeline:[{id:'s',title:'s',items:[{kind:'cue' as const,id:'c',label:'c',bullets:[],segments:[{kind:'text' as const,text:'hello'}]}]}]};
  const opts={composition,dslPath:join(dir,'in.xml'),scriptOut:join(dir,'script.json'),timelineOut:join(dir,'timeline.json'),outDir:join(dir,'out'),config:{providers:{auritus:{python:fake}}},verboseLogs:false};
  assert.equal((await generateComposition(opts)).didSynthesize,true);
  const previous=JSON.parse(readFileSync(join(dir,'timeline.resolved.json'),'utf8'));
  assert.equal((await generateComposition(opts)).didSynthesize,false);
  const repeated=JSON.parse(readFileSync(join(dir,'timeline.resolved.json'),'utf8')); assert.deepEqual(previous,repeated);
  composition.voiceover.speed=1.1; assert.equal((await generateComposition(opts)).didSynthesize,true);
  composition.timeline[0].items[0].segments[0].text='changed'; assert.equal((await generateComposition(opts)).didSynthesize,true);
 } finally {if(old===undefined) delete process.env.VML_FAKE_CACHE; else process.env.VML_FAKE_CACHE=old; rmSync(dir,{recursive:true,force:true});}
});
test('Gaussian parameters reject invalid values and clamp samples', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-gaussian-bounds-'));
 const base={dslPath:join(dir,'in.xml'),scriptOut:join(dir,'script.json'),timelineOut:join(dir,'timeline.json'),outDir:join(dir,'out'),config:{},verboseLogs:false};
 try {const composition={id:'bounds',voiceover:{provider:'dry-run',seed:0},timeline:[{id:'s',title:'s',time:{start:0,end:1},items:[{kind:'pause' as const,mode:'gaussian' as const,mean:1,std:0,min:0,max:.25}]}]};
  await generateComposition({...base,composition}); const timeline=JSON.parse(readFileSync(base.timelineOut,'utf8'));assert.equal(timeline.items.find((x:any)=>x.type==='pause').sampleCount,6000);
  composition.timeline[0].items[0].std=-1; await assert.rejects(generateComposition({...base,composition}),/Gaussian/);
  composition.timeline[0].items[0].std=0;composition.timeline[0].items[0].min=2;await assert.rejects(generateComposition({...base,composition}),/Gaussian/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('fractional source start and insertion shift are rounded once after combining', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-fractional-'));
 try {const cue={kind:'cue' as const,id:'c',label:'c',bullets:[],segments:[{kind:'text' as const,text:'hello'}]};
  const composition={id:'fractional',voiceover:{provider:'auritus'},timeline:[{id:'first',title:'first',time:{start:0,end:0},items:[]},{kind:'transition' as const,id:'insert',mode:'insert' as const,durationSeconds:.7/24000},{id:'second',title:'second',time:{start:.3/24000,end:2},items:[cue]}]};
  await generateComposition({composition,dslPath:join(dir,'in.xml'),scriptOut:join(dir,'s.json'),timelineOut:join(dir,'t.json'),outDir:join(dir,'out'),config:{providers:{auritus:{python:fake}}},verboseLogs:false});
  const frozen=JSON.parse(readFileSync(join(dir,'t.resolved.json'),'utf8'));assert.equal(frozen.segments[0].startSample,1);const script=JSON.parse(readFileSync(join(dir,'s.json'),'utf8'));assert.equal(script.scenes[1].cues[0].startSec,1/24000);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
import { GenerationSession } from '../../src/providers/tts/auritus.js';
test('concurrent generations cannot publish into the same output directory', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-lock-'));const session=new GenerationSession();
 const composition={id:'lock',voiceover:{provider:'auritus'},timeline:[{id:'s',title:'s',items:[{kind:'cue' as const,id:'c',label:'c',bullets:[],segments:[{kind:'text' as const,text:'staging-timeout'}]}]}]};
 const opts={composition,dslPath:join(dir,'in.xml'),scriptOut:join(dir,'s.json'),timelineOut:join(dir,'t.json'),outDir:join(dir,'out'),config:{providers:{auritus:{python:fake}}},generationSession:session,verboseLogs:false};
 const first=generateComposition(opts);
 try {await assert.rejects(generateComposition(opts),/already in use/);session.cancel();await assert.rejects(first);await assert.rejects(session.dispose());assert.equal((await import('node:fs')).existsSync(join(dir,'out','.generation-lock')),false);}
 finally {rmSync(dir,{recursive:true,force:true});}
});

test('trailing standalone pauses and silence-only compositions preserve total samples', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-tail-'));
 try {const pause={kind:'pause' as const,mode:'fixed' as const,seconds:10/24000};
  const cue={kind:'cue' as const,id:'c',label:'c',bullets:[],segments:[{kind:'text' as const,text:'hello'}]};
  const base={dslPath:join(dir,'in.xml'),scriptOut:join(dir,'script.json'),timelineOut:join(dir,'timeline.json'),audioOut:join(dir,'audio.wav'),outDir:join(dir,'out'),config:{providers:{auritus:{python:fake}}},verboseLogs:false};
  const result=await generateComposition({...base,composition:{id:'tail',voiceover:{provider:'auritus'},timeline:[{id:'s',title:'s',items:[cue,pause]}]}});
  const timing=JSON.parse(readFileSync(join(dir,'timeline.resolved.json'),'utf8'));assert.equal(timing.audioTotalSamples,24010);assert.equal(parseWav(readFileSync(base.audioOut)).data.length/2,24010);await verifyFrozenRenderAudio(timing,base.outDir,result.frozenAudioPath);
  const silence=await generateComposition({...base,composition:{id:'silence',voiceover:{provider:'dry-run'},timeline:[{id:'s',title:'s',time:{start:0,end:1},items:[pause]}]}});
  const silentTiming=JSON.parse(readFileSync(join(dir,'timeline.resolved.json'),'utf8'));assert.equal(silentTiming.audioTotalSamples,10);assert.equal(silentTiming.segments.length,0);await verifyFrozenRenderAudio(silentTiming,base.outDir,silence.frozenAudioPath);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('scene and transition child intervals resolve relative to their parent', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-visual-timing-'));
 try {const layer={id:'layer:雪',timing:{startSec:.5,endSec:1.5},components:[{id:'component:a',type:'Title',timing:{startSec:.25,endSec:.75}}]};
  const composition={id:'visual',meta:{fps:30},timeline:[{id:'scene',title:'scene',time:{start:2,end:4},items:[],layers:[layer]},{kind:'transition' as const,id:'transition',time:{start:4,end:5},layers:[{id:'tl',timing:{startSec:.25,endSec:.75},components:[{id:'tc',type:'Title',timing:{startSec:.1,endSec:.2}}]}]}]};
  await generateComposition({composition,dslPath:join(dir,'in.xml'),scriptOut:join(dir,'s.json'),timelineOut:join(dir,'t.json'),outDir:join(dir,'out'),config:{},verboseLogs:false});
  const t=JSON.parse(readFileSync(join(dir,'t.resolved.json'),'utf8'));assert.deepEqual(t.layers.map((x:any)=>[x.startFrame,x.endFrame]),[[75,105],[127,143]]);assert.deepEqual(t.components.map((x:any)=>[x.startFrame,x.endFrame]),[[82,98],[130,134]]);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('delayed narration and trailing pause determine frozen composition duration', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-delay-'));
 try {const cue={kind:'cue' as const,id:'c',label:'c',bullets:[],segments:[{kind:'text' as const,text:'hello'}]};
  const composition={id:'delay',voiceover:{provider:'auritus'},timeline:[{id:'s',title:'s',time:{start:0,end:1},items:[]},{kind:'narration' as const,id:'n',time:{start:.5},items:[cue,{kind:'pause' as const,mode:'fixed' as const,seconds:2}]}]};
  const outDir=join(dir,'out');const result=await generateComposition({composition,dslPath:join(dir,'in.xml'),scriptOut:join(dir,'script.json'),timelineOut:join(dir,'timeline.json'),audioOut:join(dir,'audio.wav'),outDir,config:{providers:{auritus:{python:fake}}},verboseLogs:false});
  const timing=JSON.parse(readFileSync(join(dir,'timeline.resolved.json'),'utf8'));assert.equal(timing.audioTotalSamples,84000);assert.equal(timing.durationFrames,105);assert.equal(parseWav(readFileSync(join(dir,'audio.wav'))).data.length/2,84000);await verifyFrozenRenderAudio(timing,outDir,result.frozenAudioPath);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('short narration uses measured samples without retrying', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-short-'));
 try {const cue={kind:'cue' as const,id:'c',label:'c',bullets:[],segments:[{kind:'text' as const,text:'short'}]};const composition={id:'short',voiceover:{provider:'auritus'},timeline:[{id:'s',title:'s',time:{start:0,end:1},items:[]},{kind:'narration' as const,id:'n',time:{start:0},items:[cue]}]};
  await generateComposition({composition,dslPath:join(dir,'in.xml'),scriptOut:join(dir,'s.json'),timelineOut:join(dir,'t.json'),audioOut:join(dir,'a.wav'),outDir:join(dir,'out'),config:{providers:{auritus:{python:fake}}},verboseLogs:false});
  assert.equal(parseWav(readFileSync(join(dir,'a.wav'))).data.length/2,2);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('nonzero fake tone is placed exactly after lead and trim before pauses',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'vml-tone-'));
 try {const composition={id:'tone',meta:{fps:2},voiceover:{provider:'auritus',leadInSeconds:.125,trimEndSeconds:.25},timeline:[{id:'a',title:'a',items:[{kind:'cue' as const,id:'c',label:'c',bullets:[],segments:[{kind:'text' as const,text:'tone'},{kind:'pause' as const,pause:{kind:'pause' as const,mode:'fixed' as const,seconds:.125}}]}]},{id:'b',title:'b',items:[{kind:'cue' as const,id:'d',label:'d',bullets:[],segments:[{kind:'pause' as const,pause:{kind:'pause' as const,mode:'fixed' as const,seconds:.5}}]}]}]};
  const outDir=join(dir,'out');const audio=join(dir,'audio.wav');const result=await generateComposition({composition,dslPath:join(dir,'in.xml'),scriptOut:join(dir,'script.json'),timelineOut:join(dir,'timeline.json'),audioOut:audio,outDir,config:{providers:{auritus:{python:fake}}},verboseLogs:false});
  const timing=JSON.parse(readFileSync(join(dir,'timeline.resolved.json'),'utf8'));const pcm=parseWav(readFileSync(audio)).data;assert.equal(timing.audioTotalSamples,36000);assert.equal(timing.durationFrames,3);assert.equal(timing.segments[0].startSample,3000);assert.equal(timing.segments[0].endSample,21000);assert.equal(timing.segments[0].trimSamples,6000);assert.equal(timing.segments[0].pauseSamples,15000);
  assert(pcm.subarray(0,6000).every(byte=>byte===0));for(let i=0;i<18000;i++)assert.equal(pcm.readInt16LE((i+3000)*2),(Math.round(Math.sin(2*Math.PI*440*i/24000)*12000)||0));assert(pcm.subarray(42000).every(byte=>byte===0));await verifyFrozenRenderAudio(timing,outDir,result.frozenAudioPath);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
