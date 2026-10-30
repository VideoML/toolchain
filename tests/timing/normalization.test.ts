import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {normalizeSourceElement,implicitTransitionId,qualifiedTimingId, type SourceElement} from '@videoml/shared/resolved-timing';
import {loadVideoFileFromXml} from '../../src/dsl/xml.js';
import {generateComposition} from '../../src/generate.js';

test('XML to DSL to script preserves nested wrapper IDs and Unicode on roundtrip',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'vml-normalize-'));
 try {const xml='<vml id="v"><voiceover provider="dry-run"/><scene id="s:雪"><stack><sequence><video-title/><video-title/></sequence></stack><cue id="cue:雪"><pause seconds="1"/></cue></scene></vml>';
  const raw=new DOMParser().parseFromString(xml,'text/xml');normalizeSourceElement(raw.documentElement as unknown as SourceElement);const normalized=new XMLSerializer().serializeToString(raw);const expected=Array.from(raw.getElementsByTagName('video-title')).map(node=>node.getAttribute('id'));
  const doc=loadVideoFileFromXml(xml);const composition=doc.compositions[0];await generateComposition({composition,dslPath:join(dir,'in.xml'),scriptOut:join(dir,'s.json'),timelineOut:join(dir,'t.json'),outDir:join(dir,'out'),config:{},verboseLogs:false});
  const script=JSON.parse(readFileSync(join(dir,'s.json'),'utf8')),frozen=JSON.parse(readFileSync(join(dir,'t.resolved.json'),'utf8'));assert.deepEqual(script.scenes[0].components.map((x:any)=>x.id),expected);assert.deepEqual(frozen.components.map((x:any)=>x.id),expected.map(id=>qualifiedTimingId('component',['s:雪',id!])));
  const again=loadVideoFileFromXml(normalized);assert.deepEqual((again.compositions[0].timeline[0] as any).components.map((x:any)=>x.id),expected);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
for(const name of ['animation-anime','title-slide-demo','transitions-crossfade']) test(`existing ${name} example normalizes and generates`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'vml-example-'));try {const path=resolve(`tests/timing/fixtures/${name}.babulus.xml`);const composition=loadVideoFileFromXml(readFileSync(path,'utf8')).compositions[0];await generateComposition({composition,dslPath:path,scriptOut:join(dir,'s.json'),timelineOut:join(dir,'t.json'),outDir:join(dir,'out'),config:{},verboseLogs:false});const frozen=JSON.parse(readFileSync(join(dir,'t.resolved.json'),'utf8'));assert(frozen.components.length>0);}
 finally {rmSync(dir,{recursive:true,force:true});}
});
test('implicit transitions use the shared adjacent-scene identity',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'vml-implicit-'));try {const xml='<vml id="v"><voiceover provider="dry-run"/><scene id="a:雪" transition-to-next="crossfade" transition-duration="0.5"><cue id="one"><pause seconds="1"/></cue></scene><scene id="b"><cue id="two"><pause seconds="1"/></cue></scene></vml>';const composition=loadVideoFileFromXml(xml).compositions[0];await generateComposition({composition,dslPath:join(dir,'in.xml'),scriptOut:join(dir,'s.json'),timelineOut:join(dir,'t.json'),outDir:join(dir,'out'),config:{},verboseLogs:false});const frozen=JSON.parse(readFileSync(join(dir,'t.resolved.json'),'utf8'));assert.equal(frozen.transitions[0].id,qualifiedTimingId('transition',[implicitTransitionId('a:雪','b')]));}
 finally {rmSync(dir,{recursive:true,force:true});}
});
test('raw TS missing visual IDs are normalized without mutating authoring objects',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'vml-ts-ids-'));
 try {const component={type:'Title'} as any;const composition={id:'ts',voiceover:{provider:'dry-run'},timeline:[{id:'s',title:'s',time:{start:0,end:1},items:[],components:[component]}]};
  await generateComposition({composition,dslPath:join(dir,'in.ts'),scriptOut:join(dir,'s.json'),timelineOut:join(dir,'t.json'),outDir:join(dir,'out'),config:{},verboseLogs:false});
  const script=JSON.parse(readFileSync(join(dir,'s.json'),'utf8'));assert(script.scenes[0].components[0].id.startsWith('@videoml:auto:'));assert.equal(component.id,undefined);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('reserved source IDs are accepted only at their recomputed position',()=>{
 const original='<vml id="v"><scene id="s"><video-title/><video-title/></scene></vml>';const raw=new DOMParser().parseFromString(original,'text/xml');normalizeSourceElement(raw.documentElement as unknown as SourceElement);const nodes=raw.getElementsByTagName('video-title');const first=nodes.item(0)!,second=nodes.item(1)!;const id=first.getAttribute('id');first.setAttribute('id',second.getAttribute('id'));second.setAttribute('id',id);
 assert.throws(()=>loadVideoFileFromXml(new XMLSerializer().serializeToString(raw)),/reserved/);
});
