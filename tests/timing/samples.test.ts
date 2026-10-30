import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSilenceWav } from '../../src/audio/wav.js';
test('silence rounds to nearest sample with halves upward', () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-timing-'));
 try { const path=join(dir,'silence.wav'); writeSilenceWav(path,1.4/24000,24000); assert.equal((readFileSync(path).length-44)/2,1); writeSilenceWav(path,1.5/24000,24000); assert.equal((readFileSync(path).length-44)/2,2); }
 finally {rmSync(dir,{recursive:true,force:true});}
});
import { exactTrimPcm, parseWav, writePcmWav } from '../../src/audio/wav.js';
test('trim uses exact samples and preserves untrimmed input', () => {
 const original=Buffer.from([1,0,2,0,3,0,4,0]);
 const result=exactTrimPcm(original,1.5/24000,24000);
 assert.equal(result.trimSamples,2); assert.deepEqual([...result.pcm],[1,0,2,0]); assert.equal(original.length,8);
 assert.throws(()=>exactTrimPcm(original,4/24000,24000),/less than/);
 assert.throws(()=>exactTrimPcm(original,-1,24000),/Invalid/);
});
test('PCM WAV roundtrip and malformed chunks', () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-pcm-'));
 try {const path=join(dir,'audio.wav');const pcm=Buffer.from([1,0,2,0]); writePcmWav(path,pcm,24000);assert.deepEqual(parseWav(readFileSync(path)).data,pcm);assert.throws(()=>parseWav(readFileSync(path).subarray(0,45)),/length|Truncated/);}
 finally {rmSync(dir,{recursive:true,force:true});}
});
import { voiceCacheKey, identityFromCapabilities, readVoiceCache, writeVoiceCache } from '../../src/audio/voice-cache.js';
import { createHash } from 'node:crypto';
test('cache requires both immutable revisions and a null disabled reason', () => {
 const caps={backend:'kokoro',modelId:'model',modelRevision:'model-rev',auritusVersion:'1',voice:'kokoro:af_heart',cacheDisabledReason:null,options:{referenceAudio:false},extensions:{'auritus.kokoro':{voiceRevision:'voice-rev'}}};
 const request={text:'hello',voice:'kokoro:af_heart',speed:1,seed:0,sampleRateHz:24000,ffmpeg:{executableSha256:'a'.repeat(64),versionOutputSha256:'b'.repeat(64)}};
 const a=identityFromCapabilities(caps,request).identity!; assert.ok(a); const key=voiceCacheKey(a);
 for(const change of [{text:'other'}, {speed:2}, {modelRevision:'other'}, {voiceRevision:'other'}, {referenceAudioSha256:'a'.repeat(64)}, {referenceTranscriptSha256:'b'.repeat(64)}, {output:{...a.output,ffmpeg:{...a.output.ffmpeg,versionOutputSha256:'c'.repeat(64)}}}]) assert.notEqual(voiceCacheKey({...a,...change}),key);
 assert.equal(identityFromCapabilities({...caps,cacheDisabledReason:'unavailable'},request).identity,null);
 assert.equal(identityFromCapabilities({...caps,extensions:{}},request).identity,null);
});
test('cache verifies PCM and WAV hashes before reuse', () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-cache-')); const source=join(dir,'source.wav'); const out=join(dir,'out.wav');
 try {const pcm=Buffer.from([1,0,2,0]);writePcmWav(source,pcm,24000);const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');const result={audioSha256:sha(readFileSync(source)),pcmSha256:sha(pcm),sampleRate:24000,sampleCount:2};const cache=join(dir,'cache');writeVoiceCache(cache,'key',source,result);assert.deepEqual(readVoiceCache(cache,'key',out),result);writePcmWav(join(cache,'key.wav'),Buffer.from([3,0,4,0]),24000);assert.equal(readVoiceCache(cache,'key',out),null);}
 finally {rmSync(dir,{recursive:true,force:true});}
});
import { prepareVoicePcm } from '../../src/audio/voice-pcm.js';
test('FFmpeg resamples before exact trim and sample counting', () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-resample-'));
 try {const input=join(dir,'raw.wav'),output=join(dir,'out.wav');writePcmWav(input,Buffer.alloc(4800*2),48000);
  const result=prepareVoicePcm(input,output,24000,0.01); assert.deepEqual(result,{sampleCount:2160,trimSamples:240}); assert.equal(parseWav(readFileSync(output)).data.length/2,2160); assert.equal(parseWav(readFileSync(input)).data.length/2,4800);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
import { qualifiedTimingId, validateResolvedTiming, verifyResolvedAudio } from '@videoml/shared/resolved-timing';
test('qualified IDs distinguish delimiters, Unicode, paths and numeric segment positions', () => {
 assert.notEqual(qualifiedTimingId('component',['a:b','c']),qualifiedTimingId('component',['a','b:c']));
 assert.notEqual(qualifiedTimingId('component',['é','雪']),qualifiedTimingId('component',['é雪']));
 assert.notEqual(qualifiedTimingId('segment',['cue',1]),qualifiedTimingId('segment',['cue','1']));
 assert.throws(()=>qualifiedTimingId('component',['']));
});
test('resolved audio validation rejects corrupt WAV before playback', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-resolved-')); try {
  const path=join(dir,'a.wav'); const pcm=Buffer.from([1,0,2,0]); writePcmWav(path,pcm,24000); const wav=readFileSync(path);
  const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');const id=qualifiedTimingId('cue',['c']);
  const timing={schemaVersion:1 as const,fps:30,sampleRateHz:24000,durationFrames:1,generationSeed:0,leadInSamples:0,audioTotalSamples:2,scenes:[],cues:[{id,startFrame:0,endFrame:1}],layers:[],components:[],transitions:[],segments:[{id:qualifiedTimingId('segment',['c',0]),cueId:id,track:'main',startSample:0,endSample:2,startFrame:0,endFrame:1,audioPath:'audio.wav',audioSha256:sha(wav),pcmSha256:sha(pcm),originalText:'x',expandedText:'x',trimSamples:0,pauseSamples:0,provenance:{provider:'dry-run',simulated:true,audioSha256:sha(wav),pcmSha256:sha(pcm),extensions:{}}}]};
  validateResolvedTiming(timing);await verifyResolvedAudio(timing,async()=>Uint8Array.from(wav).buffer,async()=>Uint8Array.from(wav).buffer);
  const corrupt=Buffer.from(wav);corrupt[44]^=1;await assert.rejects(verifyResolvedAudio(timing,async()=>Uint8Array.from(corrupt).buffer),/integrity/);
  const chunk=(name:string, payload:Buffer) => {const header=Buffer.alloc(8);header.write(name);header.writeUInt32LE(payload.length,4);return Buffer.concat([header,payload,payload.length%2?Buffer.alloc(1):Buffer.alloc(0)]);};
  const riff=(...chunks:Buffer[])=>{const result=Buffer.concat([wav.subarray(0,12),...chunks]);result.writeUInt32LE(result.length-8,4);return result;};
  const fmt=wav.subarray(12,36), data=wav.subarray(36), badRate=Buffer.from(fmt), badAlign=Buffer.from(fmt);badRate.writeUInt32LE(1,16);badAlign.writeUInt16LE(1,20);
  const odd=riff(fmt,data,chunk('JUNK',Buffer.from([1])));const truncated=odd.subarray(0,odd.length-1);truncated.writeUInt32LE(truncated.length-8,4);
  for(const bad of [riff(fmt,data,data),riff(fmt,fmt,data),riff(data,fmt),truncated,riff(badRate,data),riff(badAlign,data)]) {
    assert.throws(()=>parseWav(bad));
    await assert.rejects(verifyResolvedAudio(timing,async()=>Uint8Array.from(bad).buffer,async()=>Uint8Array.from(wav).buffer));
  }
  const extended=riff(fmt,chunk('JUNK',Buffer.from([1])),data);assert.deepEqual(parseWav(extended).data,pcm);
  const canonical=await verifyResolvedAudio({...timing,segments:[]},async()=>{throw Error('unused');},async()=>Uint8Array.from(riff(fmt,chunk('JUNK',Buffer.from([1])),chunk('data',Buffer.alloc(4)))).buffer);
  assert.equal(canonical?.byteLength,48);

 } finally {rmSync(dir,{recursive:true,force:true});}
});
import { inspectFfmpeg } from '../../src/audio/ffmpeg-identity.js';
import { chmodSync, writeFileSync } from 'node:fs';
test('FFmpeg binary and build output affect cache identity', () => {
 const dir=mkdtempSync(join(tmpdir(),'vml-ffmpeg-id-'));
 try { const exe=join(dir,'fake-ffmpeg');writeFileSync(exe,'#!/bin/sh\nprintf "ffmpeg version one\\nconfiguration: build-one\\n"\n');chmodSync(exe,0o755);
  const one=inspectFfmpeg(exe);assert.match(one.versionBuildOutput,/configuration: build-one/);
  writeFileSync(exe,'#!/bin/sh\nprintf "ffmpeg version two\\nconfiguration: build-two\\n"\n'); const two=inspectFfmpeg(exe);
  assert.notEqual(one.executableSha256,two.executableSha256);assert.notEqual(one.versionOutputSha256,two.versionOutputSha256);
  writeFileSync(exe,'#!/bin/sh\nprintf "ffmpeg version $VML_FFMPEG_TEST\nconfiguration: build\n"\n');const prior=process.env.VML_FFMPEG_TEST;process.env.VML_FFMPEG_TEST='one';const three=inspectFfmpeg(exe);process.env.VML_FFMPEG_TEST='two';const four=inspectFfmpeg(exe);if(prior===undefined)delete process.env.VML_FFMPEG_TEST;else process.env.VML_FFMPEG_TEST=prior;assert.equal(three.executableSha256,four.executableSha256);assert.notEqual(three.versionOutputSha256,four.versionOutputSha256);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
import {normalizeSourceTree,implicitTransitionId} from '@videoml/shared/resolved-timing';
test('source normalization is deterministic, collision-safe and round-trippable',()=>{
 const source={kind:'root' as const,id:'v',children:[{kind:'scene' as const,id:'s:雪',children:[{kind:'stack' as const,children:[{kind:'component' as const,children:[]},{kind:'sequence' as const,children:[{kind:'component' as const,children:[]}]}]},{kind:'layer' as const,children:[{kind:'component' as const,children:[]}]}]}]};
 const normalized=normalizeSourceTree(source);const scene=normalized.children[0],stack=scene.children[0];assert.notEqual(stack.children[0].id,stack.children[1].children[0].id);assert(normalized.children[0].children[1].id?.startsWith('@videoml:auto:'));
 assert.deepEqual(normalizeSourceTree(normalized),normalized);
 const forged=structuredClone(normalized);forged.children[0].children[0].children[0].id='@videoml:auto:forged';assert.throws(()=>normalizeSourceTree(forged),/reserved/);
 assert.notEqual(implicitTransitionId('a:b','c'),implicitTransitionId('a','b:c'));
});
