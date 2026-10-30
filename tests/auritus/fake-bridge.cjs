#!/usr/bin/env node
const fs=require('fs'), crypto=require('crypto'), readline=require('readline');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const q=JSON.parse(line); console.error('fake diagnostic');
 if(q.text==='staging-timeout') {const parent=require('path').dirname(q.outputDir); fs.mkdirSync(parent+'/.auritus-speech-partial'); fs.writeFileSync(parent+'/.auritus-speech-partial/partial.wav','partial'); return;}
 if(q.text==='timeout') return;
 if(q.text==='fatal') return process.exit(7);
 if(q.text==='mismatch') return console.log(JSON.stringify({protocol:1,id:'wrong',ok:true,result:{}}));
 if(q.text==='malformed') return console.log('not json');
 if(q.text==='error') return console.log(JSON.stringify({protocol:1,id:q.id,ok:false,error:{code:'MODEL_NOT_INSTALLED',message:'missing'}}));
 if(q.op==='capabilities' && q.voice==='kokoro:badcap') return console.log(JSON.stringify({protocol:1,id:q.id,ok:true,result:{broken:true}}));
 if(q.op==='capabilities') return console.log(JSON.stringify({protocol:1,id:q.id,ok:true,result:{installed:true,ready:true,backend:'fake',modelId:'fake',modelRevision:null,auritusVersion:'1',voice:q.voice,voices:[],options:{speed:true,seed:true,referenceAudio:false,phonemes:false},cacheDisabledReason:'simulated',extensions:{}}}));
 const pcm=Buffer.alloc(48000);const wav=Buffer.alloc(44+pcm.length);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);
 fs.writeFileSync(q.outputDir+'/speech.wav',wav);
 const response={protocol:1,id:q.id,ok:true,result:{audioPath:'speech.wav',metadataPath:'speech.json',audioSha256:hash(wav),pcmSha256:hash(pcm),sampleRate:24000,sampleCount:24000,durationSec:1,segments:[],provenance:{requestKey:'a'.repeat(64),backend:'fake',modelId:'fake',modelRevision:null,auritusVersion:'1',voice:q.voice,speed:q.speed,seed:q.seed,cacheDisabledReason:'fake',contentHash:null,referenceAudioSha256:null,referenceTranscriptSha256:null,extensions:{}},extensions:{}}}; if(q.text==='wrong-voice') response.result.provenance.voice='kokoro:other'; if(q.text==='overlap') response.result.segments=[{text:'a',startSec:0,endSec:0.8},{text:'b',startSec:0.7,endSec:1}]; if(q.text==='bad-path') response.result.audioPath='../escape.wav'; if(q.text==='bad-hash') response.result.pcmSha256='0'.repeat(64); fs.writeFileSync(q.outputDir+'/speech.json',JSON.stringify(response.result)); console.log(JSON.stringify(response)); if(q.text==='exit-after') process.exit(7); if(q.text==='ignore-eof') setInterval(()=>{},1000);
});
