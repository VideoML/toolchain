import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTtsProvider } from '../../src/providers/tts/registry.js';
import { getDefaultProvider } from '../../src/config.js';
test('selection is explicit in CI', () => {
  const ci=process.env.CI; const key=process.env.OPENAI_API_KEY;
  process.env.CI='true'; delete process.env.OPENAI_API_KEY;
  try { assert.equal(getDefaultProvider({}), null); assert.throws(() => getTtsProvider('openai',{}), /credential|api.key/i); assert.equal(getTtsProvider('dry-run',{}).name, 'dry-run'); }
  finally { if(ci===undefined) delete process.env.CI; else process.env.CI=ci; if(key===undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=key; }
});
import { AuritusProvider } from '../../src/providers/tts/auritus.js';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const fake=resolve('tests/auritus/fake-bridge.cjs');
test('persistent bridge recovers from request errors and validates audio', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-bridge-')); const p=new AuritusProvider(fake,undefined,1000);
 try { const req={text:'error',sampleRateHz:24000}; await assert.rejects(p.synthesize(req,join(dir,'one.wav')),/MODEL_NOT_INSTALLED/); const out=join(dir,'two.wav'); await p.synthesize({...req,text:'good'},out); assert(existsSync(out)); assert(existsSync(out+'.json')); }
 finally {await p.dispose();rmSync(dir,{recursive:true,force:true});}
});
test('malformed and timeout are fatal and clean partial directories', async () => {
 for(const text of ['malformed','mismatch','fatal','timeout']) { const dir=mkdtempSync(join(tmpdir(),'vml-bridge-')); const p=new AuritusProvider(fake,undefined,100);
  try {await assert.rejects(p.synthesize({text,sampleRateHz:24000},join(dir,'a.wav'))); await assert.rejects(p.synthesize({text:'good',sampleRateHz:24000},join(dir,'b.wav'))); assert.deepEqual((await import('node:fs')).readdirSync(dir),[]);}
  finally {await assert.rejects(p.dispose());rmSync(dir,{recursive:true,force:true});}
 }
});
test('missing executable fails', async () => {const p=new AuritusProvider('/missing/videoml-python',undefined,100);try {await assert.rejects(p.capabilities(),/unavailable/);} finally {await assert.rejects(p.dispose());}});

import { generateComposition } from '../../src/generate.js';
test('scene and narration generation both use the bridge, without cache reuse', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-generation-'));
 const cue=(id:string) => ({kind:'cue' as const,id,label:id,segments:[{kind:'text' as const,text:'hello'}],bullets:[]});
 const composition={id:'test',voiceover:{provider:'auritus'},timeline:[{id:'scene',title:'scene',items:[cue('scene-cue')]},{kind:'narration' as const,id:'narration',time:{start:1},items:[cue('narration-cue')]}]};
 const opts={composition,dslPath:join(dir,'project.xml'),scriptOut:join(dir,'script.json'),timelineOut:join(dir,'timeline.json'),audioOut:null,outDir:join(dir,'out'),config:{providers:{auritus:{python:fake}}},verboseLogs:false};
 try {const first=await generateComposition(opts); assert.equal(first.didSynthesize,true); const second=await generateComposition(opts); assert.equal(second.didSynthesize,true);}
 finally {rmSync(dir,{recursive:true,force:true});}
});

test('visual-only generation does not need or spawn a provider', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-visual-'));
 try { await generateComposition({composition:{id:'visual',timeline:[{id:'scene',title:'scene',items:[],time:{start:0,end:1}}]},dslPath:join(dir,'v.xml'),scriptOut:join(dir,'s.json'),timelineOut:join(dir,'t.json'),outDir:join(dir,'out'),config:{},verboseLogs:false}); }
 finally {rmSync(dir,{recursive:true,force:true});}
});

import { speechSetupCommand } from '../../../cli/src/speech-setup.js';
test('explicit setup constructs bounded argv and clears only offline flags', () => {
 const previous=process.env.HF_HUB_OFFLINE; process.env.HF_HUB_OFFLINE='1';
 try {const setup=speechSetupCommand('/python path','kokoro:af_heart'); assert.equal(setup.command,'/python path'); assert.equal(setup.args.at(-1),'kokoro:af_heart'); assert.match(setup.args[1],/allow_patterns/); assert.match(setup.args[1],/backend.model_id/); assert.match(setup.args[1],/voices\//); assert.equal(setup.env.HF_HUB_OFFLINE,undefined); assert.throws(()=>speechSetupCommand('python','kokoro:../bad'));}
 finally {if(previous===undefined) delete process.env.HF_HUB_OFFLINE; else process.env.HF_HUB_OFFLINE=previous;}
});
import { spawnSync } from 'node:child_process';
import { writeFileSync, chmodSync } from 'node:fs';
test('setup invokes the selected executable with bounded args and child-only environment', () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-setup-')); const fakePython=join(dir,'fake-python');
 try {writeFileSync(fakePython, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({args:process.argv.slice(2),offline:process.env.HF_HUB_OFFLINE ?? null,keep:process.env.VML_SETUP_TEST}));\n'); chmodSync(fakePython,0o755); const old=process.env.HF_HUB_OFFLINE; process.env.HF_HUB_OFFLINE='1'; process.env.VML_SETUP_TEST='kept';
 try {const cmd=speechSetupCommand(fakePython,'kokoro:af_heart'); const child=spawnSync(cmd.command,cmd.args,{env:cmd.env,encoding:'utf8'}); assert.equal(child.status,0); const result=JSON.parse(child.stdout); assert.deepEqual(result.args,cmd.args); assert.equal(result.offline,null); assert.equal(result.keep,'kept'); assert.equal(process.env.HF_HUB_OFFLINE,'1');}
 finally {if(old===undefined) delete process.env.HF_HUB_OFFLINE; else process.env.HF_HUB_OFFLINE=old; delete process.env.VML_SETUP_TEST;}}
 finally {rmSync(dir,{recursive:true,force:true});}
});

test('capabilities and invalid audio paths or digests', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-validation-')); const good=new AuritusProvider(fake,undefined,1000);
 try {assert.equal((await good.capabilities()).backend,'fake');} finally {await good.dispose();}
 try { for (const text of ['bad-path','bad-hash','wrong-voice','overlap']) { const p=new AuritusProvider(fake,undefined,1000); try {await assert.rejects(p.synthesize({text,sampleRateHz:24000},join(dir,text+'.wav')),/Malformed|digest|mismatched/); assert.equal(existsSync(join(dir,text+'.wav')),false);} finally {await assert.rejects(p.dispose());} } }
 finally {rmSync(dir,{recursive:true,force:true});}
});

test('malformed capabilities poison the process', async () => {
 const p=new AuritusProvider(fake,undefined,1000);
 await assert.rejects(p.capabilities('kokoro:badcap'),/Malformed/);
 await assert.rejects(p.capabilities(),/Malformed/);
 await assert.rejects(p.dispose(),/Malformed/);
});
test('late nonzero exit fails disposal', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-exit-')); const p=new AuritusProvider(fake,undefined,1000);
 try { await p.synthesize({text:'exit-after',sampleRateHz:24000},join(dir,'out.wav')); await assert.rejects(p.dispose(),/exited|closed/); }
 finally {rmSync(dir,{recursive:true,force:true});}
});
test('visual-only explicitly selected paid provider does not require credentials', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-visual-paid-'));
 try {await generateComposition({composition:{id:'visual',voiceover:{provider:'openai'},timeline:[{id:'scene',title:'scene',items:[],time:{start:0,end:1}}]},dslPath:join(dir,'v.xml'),scriptOut:join(dir,'s.json'),timelineOut:join(dir,'t.json'),audioOut:join(dir,'empty.wav'),outDir:join(dir,'out'),config:{},verboseLogs:false}); assert.equal(existsSync(join(dir,'empty.wav')),false);}
 finally {rmSync(dir,{recursive:true,force:true});}
});
test('invalid speed fails before starting a bridge', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-speed-')); const composition={id:'x',voiceover:{provider:'auritus',speed:0},timeline:[{id:'scene',title:'scene',items:[{kind:'cue' as const,id:'c',label:'c',segments:[{kind:'text' as const,text:'x'}],bullets:[]}]}]};
 try {await assert.rejects(generateComposition({composition,dslPath:join(dir,'v.xml'),scriptOut:join(dir,'s.json'),timelineOut:join(dir,'t.json'),outDir:join(dir,'out'),config:{},verboseLogs:false}),/speed/);}
 finally {rmSync(dir,{recursive:true,force:true});}
});

import { loadVideoFileFromXml } from '../../src/dsl/xml.js';
test('XML speed rejects invalid values', () => {
 for(const speed of ['0','-1','NaN','Infinity','words','']) assert.throws(()=>loadVideoFileFromXml(`<vml id="x"><voiceover speed="${speed}"/><scene id="s"/></vml>`),/speed/);
});
test('unresponsive process after EOF is killed and disposal fails', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-eof-')); const p=new AuritusProvider(fake,undefined,1000);
 try {await p.synthesize({text:'ignore-eof',sampleRateHz:24000},join(dir,'out.wav')); await assert.rejects(p.dispose(),/did not close/);}
 finally {rmSync(dir,{recursive:true,force:true});}
});

test('explicit incompatible model and format are rejected', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-options-'));
 try {for (const options of [{model:'wrong'}, {format:'mp3'}]) {
   const p=new AuritusProvider(fake,undefined,1000);
   try {await assert.rejects(p.synthesize({text:'hello',sampleRateHz:24000,...options},join(dir,'out.wav')),/model|WAV/); assert.equal(existsSync(join(dir,'out.wav')),false);}
   finally {await assert.rejects(p.dispose());}
 }} finally {rmSync(dir,{recursive:true,force:true});}
});

test('timeout and cancellation remove only request-owned staging siblings', async () => {
 for (const mode of ['timeout', 'cancel']) {
  const dir=mkdtempSync(join(tmpdir(),'vml-staging-')); const sentinel=join(dir,'unrelated'); writeFileSync(sentinel,'keep');
  const p=new AuritusProvider(fake,undefined,mode==='timeout' ? 1000 : 3000);
  try {
   const run=p.synthesize({text:'staging-timeout',sampleRateHz:24000},join(dir,'out.wav'));
   const fs = await import('node:fs');
   let staged = false;
   for (let i=0;i<100;i++) {
    const envelope = fs.readdirSync(dir).find(name=>name.startsWith('.auritus-request-'));
    if (envelope && fs.existsSync(join(dir,envelope,'.auritus-speech-partial','partial.wav'))) { staged=true; break; }
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert(staged, 'bridge created a sibling staging artifact');
   if(mode==='cancel') p.cancel();
   await assert.rejects(run,/timed out|cancelled/); await assert.rejects(p.dispose());
   assert.deepEqual((await import('node:fs')).readdirSync(dir),['unrelated']);
   assert.equal((await import('node:fs')).readFileSync(sentinel,'utf8'),'keep');
  } finally {rmSync(dir,{recursive:true,force:true});}
 }
});

import { GenerationSession } from '../../src/providers/tts/auritus.js';
test('cancelled and disposed sessions cannot lazily acquire a provider', async () => {
 const cancelled=new GenerationSession(); cancelled.cancel(); assert.throws(()=>cancelled.getAuritus({}),/closed/); await cancelled.dispose();
 const disposed=new GenerationSession(); await disposed.dispose(); assert.throws(()=>disposed.getAuritus({}),/closed/);
});
test('session rejects invalid or conflicting process configuration', async () => {
 const session=new GenerationSession();
 try {
  assert.throws(()=>session.getAuritus({python: 123}),/python/);
  assert.throws(()=>session.getAuritus({voices_dir: ''}),/voices_dir/);
  assert.throws(()=>session.getAuritus({voice: 2}),/voice/);
  assert.throws(()=>session.getAuritus({speed: Infinity}),/speed/);
  assert.throws(()=>session.getAuritus({seed: -1}),/seed/);
  const provider=session.getAuritus({python:fake,voices_dir:'/voice-a'});
  assert.equal(session.getAuritus({python:fake,voices_dir:'/voice-a'}),provider);
  assert.throws(()=>session.getAuritus({python:'other',voices_dir:'/voice-a'}),/cannot change/);
  assert.throws(()=>session.getAuritus({python:fake,voices_dir:'/voice-b'}),/cannot change/);
 } finally {await session.dispose();}
});

test('versioned cache reuses verified audio and regenerates on corruption', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-provider-cache-')); const prior=process.env.VML_FAKE_CACHE; process.env.VML_FAKE_CACHE='1';
 const p=new AuritusProvider(fake,undefined,1000); const path=join(dir,'out.wav');
 try {const req={text:'hello',sampleRateHz:24000,extra:{ffmpegIdentity:{executableSha256:'a'.repeat(64),versionOutputSha256:'b'.repeat(64)}}}; assert.equal((await p.synthesize(req,path)).cached,false); assert.equal((await p.synthesize(req,path)).cached,true); const cache=join(dir,'.voice-cache-v1'); const wav=(await import('node:fs')).readdirSync(cache).find(x=>x.endsWith('.wav'))!; writeFileSync(join(cache,wav),'corrupt'); assert.equal((await p.synthesize(req,path)).cached,false);}
 finally {await p.dispose();if(prior===undefined) delete process.env.VML_FAKE_CACHE; else process.env.VML_FAKE_CACHE=prior;rmSync(dir,{recursive:true,force:true});}
});

test('returned voice revision and cache reason must match capabilities before caching', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-provenance-'));const old=process.env.VML_FAKE_CACHE;process.env.VML_FAKE_CACHE='1';
 try {for(const text of ['bad-voice-revision','missing-voice-revision','wrong-cache-reason']) {const p=new AuritusProvider(fake,undefined,1000);
  try {await assert.rejects(p.synthesize({text,sampleRateHz:24000,extra:{ffmpegIdentity:{executableSha256:'a'.repeat(64),versionOutputSha256:'b'.repeat(64)}}},join(dir,'out.wav')),/provenance/);assert.equal(existsSync(join(dir,'.voice-cache-v1')),false);}
  finally {await assert.rejects(p.dispose());}}
 } finally {if(old===undefined)delete process.env.VML_FAKE_CACHE;else process.env.VML_FAKE_CACHE=old;rmSync(dir,{recursive:true,force:true});}
});
