import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DOMParser} from '@xmldom/xmldom';
import {loadVideoFile,generateComposition} from '@videoml/toolchain';
import {normalizeSourceElement,applyResolvedTimingToScript} from '@videoml/shared/resolved-timing';
import {resolveFrozenDom} from '@videoml/player';
class DomView {
 constructor(element){this.element=element;this.tagName=element.tagName;this.children=Array.from(element.childNodes).filter(x=>x.nodeType===1).map(x=>new DomView(x));}
 getAttribute(name){return this.element.hasAttribute(name)?this.element.getAttribute(name):null;}
 querySelectorAll(name){return this.children.flatMap(child=>[...(child.tagName===name?[child]:[]),...child.querySelectorAll(name)]);}
}
test('packed XML→DSL→script→player uses the same normalized nested identities',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'vml-packed-normalize-'));
 try {const xml='<vml id="v"><voiceover provider="dry-run"/><scene id="s:雪"><stack><sequence><video-title/><video-title/></sequence></stack><cue id="cue:雪"><pause seconds="1"/></cue></scene></vml>';const input=join(dir,'story.xml');writeFileSync(input,xml);
  const doc=await loadVideoFile(input);const result=await generateComposition({composition:doc.compositions[0],dslPath:input,scriptOut:join(dir,'script.json'),timelineOut:join(dir,'timeline.json'),outDir:join(dir,'out'),config:{},verboseLogs:false});
  const frozen=JSON.parse(readFileSync(result.resolvedTimingPath,'utf8')),script=JSON.parse(readFileSync(join(dir,'script.json'),'utf8')),timeline=JSON.parse(readFileSync(join(dir,'timeline.json'),'utf8'));
  const raw=new DOMParser().parseFromString(xml,'text/xml');normalizeSourceElement(raw.documentElement);const dom=new DomView(raw.documentElement);const mapped=resolveFrozenDom(dom,frozen);assert.equal(mapped.timedByScene.get('s:雪').length,2);assert.equal(applyResolvedTimingToScript(script,frozen,timeline).scenes[0].id,'s:雪');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
